// ============================================================================
// STENCIL BOOLEAN, CLEAN/WELD & SIGNATURE ENGINE (234.0 mm HEX WINDOW)
// ============================================================================

const PHYSICAL_HEX_WIDTH_MM = 234.0;
const UNITS_PER_MM = 200; // 1 unit = 0.005 mm (fast 32-bit integer Clipper range)
const ARC_TOLERANCE_MM = 0.025;
const MIN_FRAGMENT_AREA_MM2 = 0.20;

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

function getScaleContext(cvsW) {
    const pxPerMm = cvsW / PHYSICAL_HEX_WIDTH_MM;
    const toClipper = UNITS_PER_MM / pxPerMm;
    const toCanvas = 1 / toClipper;
    return { pxPerMm, toClipper, toCanvas };
}

function signedAreaUnits(path) {
    let area = 0;
    for (let i = 0, j = path.length - 1; i < path.length; j = i++) {
        area += (path[j].X + path[i].X) * (path[j].Y - path[i].Y);
    }
    return area * 0.5;
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

function rawPolysToClipperUnion(ClipperLib, polys, toClipper) {
    if (!polys || polys.length === 0) return [];
    const subj = [];
    for (let i = 0; i < polys.length; i++) {
        const src = polys[i];
        if (!src || src.length < 3) continue;
        const path = [];
        for (let j = 0; j < src.length; j++) {
            path.push({
                X: Math.round(src[j].x * toClipper),
                Y: Math.round(src[j].y * toClipper)
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

// Clean (-cleanMm -> +cleanMm) followed by Weld (+weldMm -> -weldMm) with Round Joins
function cleanAndWeldPaths(ClipperLib, paths, cleanMm, weldMm) {
    let res = paths;
    if (!res || res.length === 0) return [];

    if (cleanMm > 0) {
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

function buildSignatureClipperPaths(ClipperLib, cols, rows, cvsW, cvsH, toClipper) {
    const hexW = cvsW / (cols * 2 + 1);
    const hexH = cvsH / (rows * 3 + 1);
    const lastR = rows - 1;
    const lastC = cols - 1;
    const gx = (Math.abs(lastR) % 2 === 0) ? (lastC * 2 + 1) : (lastC * 2 + 2);
    const gy = lastR * 3 + 2;

    const cxUnits = gx * hexW * toClipper;
    const cyUnits = gy * hexH * toClipper;

    const rawContours = SIGNATURE_AI_REL_MM.map(contour =>
        contour.map(([dxMm, dyMm]) => ({
            X: Math.round(cxUnits + dxMm * UNITS_PER_MM),
            Y: Math.round(cyUnits + dyMm * UNITS_PER_MM)
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

function clipperPathsToSvgGroup(groupId, fillHex, paths, toCanvas, indent = '  ', hidden = false) {
    const styleAttr = hidden ? ' style="display:none"' : '';
    if (!paths || paths.length === 0) {
        return `${indent}<g id="${groupId}" fill="${fillHex}"${styleAttr}></g>\n`;
    }
    let d = '';
    for (let i = 0; i < paths.length; i++) {
        const p = paths[i];
        if (p.length < 3) continue;
        d += `M ${(p[0].X * toCanvas).toFixed(2)},${(p[0].Y * toCanvas).toFixed(2)}`;
        for (let j = 1; j < p.length; j++) {
            d += ` L ${(p[j].X * toCanvas).toFixed(2)},${(p[j].Y * toCanvas).toFixed(2)}`;
        }
        d += ' Z ';
    }
    return `${indent}<g id="${groupId}" fill="${fillHex}"${styleAttr}>\n${indent}  <path fill-rule="evenodd" d="${d.trim()}" />\n${indent}</g>\n`;
}

// Stage-1 Geometry Pipeline:
// 1. Clean (1.33mm) + Weld (0.333mm)
// 2. Boolean Algebra (CNT or CHK)
// 3. Clean (1.33mm) + Weld (0.333mm) + Hexagon Crop
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
    cleanMm = 1.33,
    weldMm = 0.333,
    enableSignature = true,
    appVersion = 'v2.0'
}) {
    const ClipperLib = await ensureClipperLoaded();
    const { toClipper, toCanvas } = getScaleContext(cvsW);
    const CT = ClipperLib.ClipType;

    const hexClipPaths = isCropped ? rawPolysToClipperUnion(ClipperLib, hexPolys, toClipper) : null;

    // 1. Pre-Boolean Union -> Clean -> Weld
    let blackPaths = isBlackEnabled
        ? cleanAndWeldPaths(ClipperLib, rawPolysToClipperUnion(ClipperLib, blackPolys, toClipper), cleanMm, weldMm)
        : [];

    let bgPaths = (isGrayEnabled && bgPolys)
        ? cleanAndWeldPaths(ClipperLib, rawPolysToClipperUnion(ClipperLib, bgPolys, toClipper), cleanMm, weldMm)
        : [];

    let grayFinalPaths = [];
    if (isGrayEnabled) {
        const grayOrigPaths = cleanAndWeldPaths(
            ClipperLib,
            rawPolysToClipperUnion(ClipperLib, grayOrigPolys, toClipper),
            cleanMm,
            weldMm
        );

        // 2. Boolean Algebra
        if (!isBlackEnabled) {
            grayFinalPaths = grayOrigPaths;
        } else if (grayRenderMode === 'checkered') {
            // CHK: (Gray \ Black) U (Black \ Gray) === Gray XOR Black
            grayFinalPaths = execClip(ClipperLib, CT.ctXor, grayOrigPaths, blackPaths);
        } else {
            // CNT: (Gray \ Black) U (Gray_Negative ∩ Black)
            const grayNegPaths = cleanAndWeldPaths(
                ClipperLib,
                rawPolysToClipperUnion(ClipperLib, grayNegPolys, toClipper),
                cleanMm,
                weldMm
            );
            const grayOnWhite = execClip(ClipperLib, CT.ctDifference, grayOrigPaths, blackPaths);
            const grayOnBlack = execClip(ClipperLib, CT.ctIntersection, grayNegPaths, blackPaths);
            grayFinalPaths = execClip(ClipperLib, CT.ctUnion, grayOnWhite, grayOnBlack);
        }

        // 3. Post-Boolean Clean -> Weld
        grayFinalPaths = cleanAndWeldPaths(ClipperLib, grayFinalPaths, cleanMm, weldMm);
    }

    // Crisp crop to Hexagon cluster so outer 60°/120° hex corners stay sharp
    if (isCropped && hexClipPaths && hexClipPaths.length > 0) {
        if (blackPaths.length > 0) {
            blackPaths = filterSmallContours(execClip(ClipperLib, CT.ctIntersection, blackPaths, hexClipPaths));
        }
        if (grayFinalPaths.length > 0) {
            grayFinalPaths = filterSmallContours(execClip(ClipperLib, CT.ctIntersection, grayFinalPaths, hexClipPaths));
        }
        if (bgPaths.length > 0) {
            bgPaths = filterSmallContours(execClip(ClipperLib, CT.ctIntersection, bgPaths, hexClipPaths));
        }
    }

    // 4. Independent XOR ("Exclude") with Signature "AI" on Gray and Black
    if (enableSignature) {
        const sigPaths = buildSignatureClipperPaths(ClipperLib, cols, rows, cvsW, cvsH, toClipper);
        if (isBlackEnabled) {
            blackPaths = execClip(ClipperLib, CT.ctXor, blackPaths, sigPaths);
        }
        if (isGrayEnabled) {
            grayFinalPaths = execClip(ClipperLib, CT.ctXor, grayFinalPaths, sigPaths);
        }
    }

    // Assemble SVG (Illustrator top-to-bottom: Layer_Gray -> Layer_Black -> Layer_Hexagons -> Background_Layer)
    const metaComment = `<!-- Iso-Xylography ${appVersion} | Clean: ${cleanMm}mm | Weld: ${weldMm}mm | Mode: ${grayRenderMode === 'checkered' ? 'CHK' : 'CNT'} -->\n`;
    let svgStr = metaComment;
    svgStr += `<svg version="1.1" id="${rootSvgId}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${cvsW} ${cvsH}">\n`;

    if (isGrayEnabled && bgPolys) {
        svgStr += clipperPathsToSvgGroup('Background_Layer', '#000000', bgPaths, toCanvas, '  ');
    }
    if (isCropped && hexClipPaths) {
        svgStr += clipperPathsToSvgGroup('Layer_Hexagons', '#FFFFFF', hexClipPaths, toCanvas, '  ');
    }
    if (isBlackEnabled) {
        svgStr += clipperPathsToSvgGroup('Layer_Black', '#000000', blackPaths, toCanvas, '  ');
    }
    if (isGrayEnabled) {
        svgStr += clipperPathsToSvgGroup('Layer_Gray', '#7f7f7f', grayFinalPaths, toCanvas, '  ');
    }

    svgStr += `</svg>`;
    return svgStr;
}