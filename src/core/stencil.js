// ============================================================================
// STENCIL BOOLEAN, CLEAN/WELD & SIGNATURE ENGINE (234.0 × 292.5 mm WINDOW)
// ============================================================================

const PHYSICAL_SHORT_MM = 234.0;
const PHYSICAL_LONG_MM = 292.5;
const MM_TO_PT = 72.0 / 25.4; // Exact Adobe Illustrator SVG point scale (1 mm = 2.83464567 pt)

const UNITS_PER_MM = 200; // 1 unit = 0.005 mm (5 microns, safe 32-bit integer Clipper range)
const SEAM_SEAL_MM = 0.025; // 25-micron pre-seal to fuse rhombus rounding slits before erosion
const ARC_TOLERANCE_MM = 0.025;
const MIN_FRAGMENT_AREA_MM2 = 0.20;
const MAX_SLIVER_RADIUS_MM = 0.35;

const CLIPPER_CDN_URLS = [
    'https://cdn.jsdelivr.net/npm/clipper-lib@6.4.2/clipper.js',
    'https://unpkg.com/clipper-lib@6.4.2/clipper.js'
];

// Exact "AI" signature contours in mm relative to bottom-right hexagon center
const SIGNATURE_AI_REL_MM = [
    [
        [5.4328, 8.8794], [2.0461, 8.8794], [0.7056, 4.8578], [-5.4681, 4.8578],
        [-6.7381, 8.8794], [-10.0542, 8.8794], [-4.0569, -8.8653], [-0.7761, -8.8653]
    ],
    [
        [-0.3175, 1.8591], [-2.4342, -4.7025], [-4.5156, 1.8591]
    ],
    [
        [6.9850, 8.8794], [6.9850, -8.8653], [10.0894, -8.8653], [10.0894, 8.8794]
    ]
];
const SIG_HALF_SPAN_X_MM = 10.0894;
const SIG_HALF_SPAN_Y_MM = 8.8794;

let clipperLoadPromise = null;

function loadScript(url) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = url;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Failed to load ${url}`));
        document.head.appendChild(script);
    });
}

export async function ensureClipperLoaded() {
    if (window.ClipperLib) return window.ClipperLib;
    if (!clipperLoadPromise) {
        clipperLoadPromise = (async () => {
            for (const url of CLIPPER_CDN_URLS) {
                try {
                    await loadScript(url);
                    if (window.ClipperLib) return window.ClipperLib;
                } catch (_) {
                    // Try fallback CDN
                }
            }
            clipperLoadPromise = null;
            throw new Error('Could not load ClipperLib from CDN.');
        })();
    }
    return clipperLoadPromise;
}

// Map source image pixels (0..cvsW, 0..cvsH) directly into true physical 234.0 × 292.5 mm space
// and output in native Illustrator points (663.31 × 829.13 pt) so offsets & "AI" stay 100% unstretched
function getScaleContext(cvsW, cvsH) {
    const isLandscape = cvsW > cvsH;
    const physWmm = isLandscape ? PHYSICAL_LONG_MM : PHYSICAL_SHORT_MM;
    const physHmm = isLandscape ? PHYSICAL_SHORT_MM : PHYSICAL_LONG_MM;

    const toClipperX = (physWmm * UNITS_PER_MM) / cvsW;
    const toClipperY = (physHmm * UNITS_PER_MM) / cvsH;
    const toSvgPt = MM_TO_PT / UNITS_PER_MM;
    const svgW = physWmm * MM_TO_PT;
    const svgH = physHmm * MM_TO_PT;

    return { physWmm, physHmm, toClipperX, toClipperY, toSvgPt, svgW, svgH };
}

function signedAreaUnits(path) {
    let area = 0;
    for (let i = 0, j = path.length - 1; i < path.length; j = i++) {
        area += (path[j].X + path[i].X) * (path[j].Y - path[i].Y);
    }
    return area * 0.5;
}

function perimeterUnits(path) {
    let perim = 0;
    for (let i = 0, j = path.length - 1; i < path.length; j = i++) {
        perim += Math.hypot(path[i].X - path[j].X, path[i].Y - path[j].Y);
    }
    return perim;
}

function pruneMicroVertices(paths, minDistUnits) {
    if (!paths || paths.length === 0) return [];
    const minDistSq = minDistUnits * minDistUnits;
    const cleaned = [];
    for (let i = 0; i < paths.length; i++) {
        const p = paths[i];
        if (!p || p.length < 3) continue;
        const out = [p[0]];
        for (let j = 1; j < p.length; j++) {
            const prev = out[out.length - 1];
            const dx = p[j].X - prev.X;
            const dy = p[j].Y - prev.Y;
            if (dx * dx + dy * dy >= minDistSq) {
                out.push(p[j]);
            }
        }
        if (out.length > 2) {
            const first = out[0];
            const last = out[out.length - 1];
            const dx = first.X - last.X;
            const dy = first.Y - last.Y;
            if (dx * dx + dy * dy < minDistSq) out.pop();
        }
        if (out.length >= 3) cleaned.push(out);
    }
    return cleaned;
}

function filterSmallContours(paths, minAreaMm2 = MIN_FRAGMENT_AREA_MM2) {
    if (!paths || paths.length === 0 || minAreaMm2 <= 0) return paths || [];
    const minUnits2 = minAreaMm2 * UNITS_PER_MM * UNITS_PER_MM;
    return paths.filter(p => p.length >= 3 && Math.abs(signedAreaUnits(p)) >= minUnits2);
}

// Remove grazing border slivers ("eyelashes") after sharp boundary crop while keeping
// 100% razor-sharp 60°/120°/90° corners on all surviving contours
function filterPostCropSlivers(ClipperLib, paths, cleanMm, weldMm, minAreaMm2 = MIN_FRAGMENT_AREA_MM2) {
    if (!paths || paths.length === 0) return [];
    const minUnits2 = Math.max(0.01, minAreaMm2) * UNITS_PER_MM * UNITS_PER_MM;
    const sliverRadiusMm = Math.min(MAX_SLIVER_RADIUS_MM, Math.max(weldMm, cleanMm * 0.25));
    const sliverRadiusUnits = sliverRadiusMm * UNITS_PER_MM;

    const kept = [];
    for (let i = 0; i < paths.length; i++) {
        const p = paths[i];
        if (!p || p.length < 3) continue;
        const absArea = Math.abs(signedAreaUnits(p));
        if (absArea < minUnits2) continue;

        if (sliverRadiusUnits > 1) {
            const perim = perimeterUnits(p);
            // Quick ribbon half-width bound (Area / Perimeter <= r_max): only run exact offset test on thin candidates
            if (perim > 0 && (absArea / perim) < sliverRadiusUnits) {
                const testRing = p.slice();
                if (!ClipperLib.Clipper.Orientation(testRing)) testRing.reverse();
                const eroded = offsetRound(ClipperLib, [testRing], -sliverRadiusMm);
                if (!eroded || eroded.length === 0) continue;
            }
        }
        kept.push(p);
    }
    return kept;
}

function buildRectClipperPaths(ClipperLib, physWmm, physHmm) {
    const wU = Math.round(physWmm * UNITS_PER_MM);
    const hU = Math.round(physHmm * UNITS_PER_MM);
    const rect = [
        { X: 0, Y: 0 },
        { X: wU, Y: 0 },
        { X: wU, Y: hU },
        { X: 0, Y: hU }
    ];
    if (!ClipperLib.Clipper.Orientation(rect)) rect.reverse();
    return [rect];
}

function rawPolysToClipperUnion(ClipperLib, polys, toClipperX, toClipperY) {
    if (!polys || polys.length === 0) return [];
    const subj = [];
    for (let i = 0; i < polys.length; i++) {
        const src = polys[i];
        if (!src || src.length < 3) continue;
        const path = [];
        for (let j = 0; j < src.length; j++) {
            path.push({
                X: Math.round(src[j].x * toClipperX),
                Y: Math.round(src[j].y * toClipperY)
            });
        }
        if (Math.abs(signedAreaUnits(path)) < 1) continue;
        if (!ClipperLib.Clipper.Orientation(path)) path.reverse();
        subj.push(path);
    }
    if (subj.length === 0) return [];

    const cpr = new ClipperLib.Clipper();
    cpr.AddPaths(subj, ClipperLib.PolyType.ptSubject, true);
    const out = [];
    cpr.Execute(
        ClipperLib.ClipType.ctUnion,
        out,
        ClipperLib.PolyFillType.pftNonZero,
        ClipperLib.PolyFillType.pftNonZero
    );
    return out;
}

function execClip(ClipperLib, clipType, subjPaths, clipPaths, fillType = ClipperLib.PolyFillType.pftEvenOdd) {
    if (!subjPaths || subjPaths.length === 0) {
        if (clipType === ClipperLib.ClipType.ctUnion || clipType === ClipperLib.ClipType.ctXor) {
            return clipPaths ? clipPaths.map(p => p.slice()) : [];
        }
        return [];
    }
    if (!clipPaths || clipPaths.length === 0) {
        if (clipType === ClipperLib.ClipType.ctIntersection) return [];
        return subjPaths.map(p => p.slice());
    }

    const cpr = new ClipperLib.Clipper();
    cpr.AddPaths(subjPaths, ClipperLib.PolyType.ptSubject, true);
    cpr.AddPaths(clipPaths, ClipperLib.PolyType.ptClip, true);
    const out = [];
    cpr.Execute(clipType, out, fillType, fillType);
    return out;
}

function offsetRound(ClipperLib, paths, deltaMm) {
    if (!paths || paths.length === 0 || Math.abs(deltaMm) < 1e-4) return paths || [];
    const deltaUnits = deltaMm * UNITS_PER_MM;
    const arcTolUnits = ARC_TOLERANCE_MM * UNITS_PER_MM;
    const co = new ClipperLib.ClipperOffset(2.0, arcTolUnits);
    co.AddPaths(paths, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
    const out = [];
    co.Execute(out, deltaUnits);
    return out;
}

// Seal 25-micron rounding slits on seams FIRST, then Clean (-cleanMm -> +cleanMm), then Weld (+weldMm -> -weldMm)
function cleanAndWeldPaths(ClipperLib, paths, cleanMm, weldMm) {
    let res = paths;
    if (!res || res.length === 0) return [];

    // Pre-seal microscopic rounding seams between adjacent rhombuses / boolean joints
    // so -cleanMm erosion never eats inward from hairline seams
    res = offsetRound(ClipperLib, res, +SEAM_SEAL_MM);
    res = offsetRound(ClipperLib, res, -SEAM_SEAL_MM);

    if (cleanMm > 0 && res.length > 0) {
        res = offsetRound(ClipperLib, res, -cleanMm);
        res = offsetRound(ClipperLib, res, +cleanMm);
    }
    if (weldMm > 0 && res.length > 0) {
        res = offsetRound(ClipperLib, res, +weldMm);
        res = offsetRound(ClipperLib, res, -weldMm);
    }
    if (res.length > 0) {
        res = pruneMicroVertices(res, 0.01 * UNITS_PER_MM);
        res = filterSmallContours(res);
    }
    return res;
}

// Build "AI" signature centered in bottom-right hexagon (1.0x original size on 3×6 and 4×8;
// smoothly scales down only on dense grids so it never overflows small hexagons)
function buildSignatureClipperPaths(ClipperLib, cols, rows, physWmm, physHmm) {
    const hexWmm = physWmm / (cols * 2 + 1);
    const hexHmm = physHmm / (rows * 3 + 1);
    const lastR = rows - 1;
    const lastC = cols - 1;
    const gx = (Math.abs(lastR) % 2 === 0) ? (lastC * 2 + 1) : (lastC * 2 + 2);
    const gy = lastR * 3 + 2;

    const cxUnits = gx * hexWmm * UNITS_PER_MM;
    const cyUnits = gy * hexHmm * UNITS_PER_MM;

    const limX = (0.75 * hexWmm) / SIG_HALF_SPAN_X_MM;
    const limSlant = 1.50 / (SIG_HALF_SPAN_X_MM / hexWmm + SIG_HALF_SPAN_Y_MM / hexHmm);
    const sigScale = Math.min(1.0, limX, limSlant);

    const rawContours = SIGNATURE_AI_REL_MM.map(contour =>
        contour.map(([dxMm, dyMm]) => ({
            X: Math.round(cxUnits + dxMm * sigScale * UNITS_PER_MM),
            Y: Math.round(cyUnits + dyMm * sigScale * UNITS_PER_MM)
        }))
    );

    const cpr = new ClipperLib.Clipper();
    cpr.AddPaths(rawContours, ClipperLib.PolyType.ptSubject, true);
    const normalized = [];
    cpr.Execute(
        ClipperLib.ClipType.ctUnion,
        normalized,
        ClipperLib.PolyFillType.pftEvenOdd,
        ClipperLib.PolyFillType.pftEvenOdd
    );
    return normalized;
}

function clipperPathsToSvgGroup(groupId, fillHex, paths, toSvgPt, indent = '  ', hidden = false) {
    const styleAttr = hidden ? ' style="display:none"' : '';
    if (!paths || paths.length === 0) {
        return `${indent}<g id="${groupId}" fill="${fillHex}"${styleAttr}></g>\n`;
    }
    let d = '';
    for (let i = 0; i < paths.length; i++) {
        const p = paths[i];
        if (p.length < 3) continue;
        d += `M ${(p[0].X * toSvgPt).toFixed(2)},${(p[0].Y * toSvgPt).toFixed(2)}`;
        for (let j = 1; j < p.length; j++) {
            d += ` L ${(p[j].X * toSvgPt).toFixed(2)},${(p[j].Y * toSvgPt).toFixed(2)}`;
        }
        d += ' Z ';
    }
    return `${indent}<g id="${groupId}" fill="${fillHex}"${styleAttr}>\n${indent}  <path fill-rule="evenodd" d="${d.trim()}" />\n${indent}</g>\n`;
}

// Stage-1 Geometry Pipeline:
// 1. Seam-Seal (0.025mm) + Clean (1.33mm) + Weld (0.333mm) on full-bleed geometry in 234.0 × 292.5 mm space
// 2. Boolean Algebra (CNT or CHK, respecting showOnWhite / showOnBlack toggles)
// 3. Seam-Seal + Clean (1.33mm) + Weld (0.333mm) + crisp Boundary Crop + Grazing Sliver Filter
// 4. Independent XOR ("Exclude") with Signature "AI" on Gray and Black
export async function buildProcessedMonoSvg({
    rootSvgId,
    cols,
    rows,
    cvsW,
    cvsH,
    bgPolys = null,
    isCropped = true,
    hexPolys = [],
    blackPolys = [],
    grayOrigPolys = [],
    grayNegPolys = [],
    grayRenderMode = 'continuous',
    isBlackEnabled = true,
    isGrayEnabled = true,
    showOnWhite = true,
    showOnBlack = true,
    cleanMm = 1.33,
    weldMm = 0.333,
    enableSignature = true,
    appVersion = 'v2.0'
}) {
    const ClipperLib = await ensureClipperLoaded();
    const { physWmm, physHmm, toClipperX, toClipperY, toSvgPt, svgW, svgH } = getScaleContext(cvsW, cvsH);
    const CT = ClipperLib.ClipType;

    const hexClipPaths = isCropped
        ? rawPolysToClipperUnion(ClipperLib, hexPolys, toClipperX, toClipperY)
        : null;
    const cropBoundaryPaths = isCropped
        ? hexClipPaths
        : buildRectClipperPaths(ClipperLib, physWmm, physHmm);

    // 1. Pre-Boolean Union -> Seam-Seal -> Clean -> Weld (with full outer bleed so border edges never pull back)
    let blackPaths = isBlackEnabled
        ? cleanAndWeldPaths(ClipperLib, rawPolysToClipperUnion(ClipperLib, blackPolys, toClipperX, toClipperY), cleanMm, weldMm)
        : [];

    let bgPaths = (isGrayEnabled && bgPolys)
        ? cleanAndWeldPaths(ClipperLib, rawPolysToClipperUnion(ClipperLib, bgPolys, toClipperX, toClipperY), cleanMm, weldMm)
        : [];

    let grayFinalPaths = [];
    if (isGrayEnabled && (showOnWhite || showOnBlack)) {
        const grayOrigPaths = cleanAndWeldPaths(
            ClipperLib,
            rawPolysToClipperUnion(ClipperLib, grayOrigPolys, toClipperX, toClipperY),
            cleanMm,
            weldMm
        );

        // 2. Boolean Algebra (respecting Show on White / Show on Black checkboxes)
        if (!isBlackEnabled) {
            grayFinalPaths = showOnWhite ? grayOrigPaths : [];
        } else if (grayRenderMode === 'checkered') {
            if (showOnWhite && showOnBlack) {
                // Full CHK: (Gray \ Black) U (Black \ Gray) === Gray XOR Black
                grayFinalPaths = execClip(ClipperLib, CT.ctXor, grayOrigPaths, blackPaths);
            } else if (showOnWhite) {
                grayFinalPaths = execClip(ClipperLib, CT.ctDifference, grayOrigPaths, blackPaths);
            } else if (showOnBlack) {
                grayFinalPaths = execClip(ClipperLib, CT.ctDifference, blackPaths, grayOrigPaths);
            }
        } else {
            // CNT: (Gray \ Black) U (Gray_Negative ∩ Black)
            const grayOnWhitePaths = showOnWhite
                ? execClip(ClipperLib, CT.ctDifference, grayOrigPaths, blackPaths)
                : [];
            let grayOnBlackPaths = [];
            if (showOnBlack) {
                const grayNegPaths = cleanAndWeldPaths(
                    ClipperLib,
                    rawPolysToClipperUnion(ClipperLib, grayNegPolys, toClipperX, toClipperY),
                    cleanMm,
                    weldMm
                );
                grayOnBlackPaths = execClip(ClipperLib, CT.ctIntersection, grayNegPaths, blackPaths);
            }
            grayFinalPaths = execClip(ClipperLib, CT.ctUnion, grayOnWhitePaths, grayOnBlackPaths);
        }

        // 3. Post-Boolean Seam-Seal -> Clean -> Weld
        grayFinalPaths = cleanAndWeldPaths(ClipperLib, grayFinalPaths, cleanMm, weldMm);
    }

    // Crisp crop to Hexagon cluster (or 234×292.5mm rectangle if uncropped) + Grazing Sliver Filter
    if (cropBoundaryPaths && cropBoundaryPaths.length > 0) {
        if (blackPaths.length > 0) {
            blackPaths = filterPostCropSlivers(
                ClipperLib,
                execClip(ClipperLib, CT.ctIntersection, blackPaths, cropBoundaryPaths),
                cleanMm,
                weldMm
            );
        }
        if (grayFinalPaths.length > 0) {
            grayFinalPaths = filterPostCropSlivers(
                ClipperLib,
                execClip(ClipperLib, CT.ctIntersection, grayFinalPaths, cropBoundaryPaths),
                cleanMm,
                weldMm
            );
        }
        if (bgPaths.length > 0) {
            bgPaths = filterPostCropSlivers(
                ClipperLib,
                execClip(ClipperLib, CT.ctIntersection, bgPaths, cropBoundaryPaths),
                cleanMm,
                weldMm
            );
        }
    }

    // 4. Independent XOR ("Exclude") with Signature "AI" on Gray and Black
    if (enableSignature) {
        const sigPaths = buildSignatureClipperPaths(ClipperLib, cols, rows, physWmm, physHmm);
        if (isBlackEnabled) {
            blackPaths = execClip(ClipperLib, CT.ctXor, blackPaths, sigPaths);
        }
        if (isGrayEnabled) {
            grayFinalPaths = execClip(ClipperLib, CT.ctXor, grayFinalPaths, sigPaths);
        }
    }

    // Assemble SVG in exact Illustrator points (663.31 × 829.13 pt === 234.0 × 292.5 mm)
    const metaComment = `<!-- Iso-Xylography ${appVersion} | Window: ${physWmm}x${physHmm}mm | Clean: ${cleanMm}mm | Weld: ${weldMm}mm | Mode: ${grayRenderMode === 'checkered' ? 'CHK' : 'CNT'} -->\n`;
    let svgStr = metaComment;
    svgStr += `<svg version="1.1" id="${rootSvgId}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgW.toFixed(2)} ${svgH.toFixed(2)}">\n`;

    if (isGrayEnabled && bgPolys) {
        svgStr += clipperPathsToSvgGroup('Background_Layer', '#000000', bgPaths, toSvgPt, '  ');
    }
    if (isCropped && hexClipPaths) {
        svgStr += clipperPathsToSvgGroup('Layer_Hexagons', '#FFFFFF', hexClipPaths, toSvgPt, '  ');
    }
    if (isBlackEnabled) {
        svgStr += clipperPathsToSvgGroup('Layer_Black', '#000000', blackPaths, toSvgPt, '  ');
    }
    if (isGrayEnabled) {
        svgStr += clipperPathsToSvgGroup('Layer_Gray', '#7f7f7f', grayFinalPaths, toSvgPt, '  ');
    }

    svgStr += `</svg>`;
    return svgStr;
}