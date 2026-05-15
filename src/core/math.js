// Вычисляет точку пересечения двух отрезков
export function computeIntersection(S, E, clipStart, clipEnd, dx2, dy2) {
    const dx1 = E.x - S.x; const dy1 = E.y - S.y;
    const det = dx1 * dy2 - dy1 * dx2;
    if (Math.abs(det) < 1e-6) return {x: E.x, y: E.y};
    const t1 = ((clipStart.x - S.x) * dy2 - (clipStart.y - S.y) * dx2) / det;
    return { x: S.x + t1 * dx1, y: S.y + t1 * dy1 };
}

// Алгоритм Сазерленда — Ходжмена для обрезки полигонов по границам ромба
export function clipPolygon(subjectPoly, clipPoly) {
    let outputList = subjectPoly;
    for (let i = 0; i < clipPoly.length; i++) {
        const clipStart = clipPoly[i]; const clipEnd = clipPoly[(i + 1) % clipPoly.length];
        const dx = clipEnd.x - clipStart.x; const dy = clipEnd.y - clipStart.y;
        const inputList = outputList; outputList = [];
        if (inputList.length === 0) break;
        
        let S = inputList[inputList.length - 1];
        for (let j = 0; j < inputList.length; j++) {
            const E = inputList[j];
            const isEInside = dx * (E.y - clipStart.y) - dy * (E.x - clipStart.x) >= -1e-6;
            const isSInside = dx * (S.y - clipStart.y) - dy * (S.x - clipStart.x) >= -1e-6;
            if (isEInside) {
                if (!isSInside) outputList.push(computeIntersection(S, E, clipStart, clipEnd, dx, dy));
                outputList.push(E);
            } else if (isSInside) {
                outputList.push(computeIntersection(S, E, clipStart, clipEnd, dx, dy));
            }
            S = E;
        }
    }
    return outputList;
}

// Сглаживание линий (только для Ч/Б режима)
export function generateSmoothPolyline(points, smoothFactor, resolution = 5) {
    if (points.length < 2 || smoothFactor === 0) return points; 
    let polyline = [points[0]];
    for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[i - 1] || points[i]; const p1 = points[i]; const p2 = points[i + 1]; const p3 = points[i + 2] || p2;
        const cp1x = p1.x + (p2.x - p0.x) / 6 * smoothFactor; const cp1y = p1.y + (p2.y - p0.y) / 6 * smoothFactor;
        const cp2x = p2.x - (p3.x - p1.x) / 6 * smoothFactor; const cp2y = p2.y - (p3.y - p1.y) / 6 * smoothFactor;
        for (let t = 1; t <= resolution; t++) {
            const u = t / resolution; const mt = 1 - u;
            const x = mt*mt*mt * p1.x + 3*mt*mt*u * cp1x + 3*mt*u*u * cp2x + u*u*u * p2.x;
            const y = mt*mt*mt * p1.y + 3*mt*mt*u * cp1y + 3*mt*u*u * cp2y + u*u*u * p2.y;
            polyline.push({x, y});
        }
    }
    return polyline;
}

export function getPolygonArea(pts) {
    let area = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        area += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
    }
    return Math.abs(area / 2);
}

export function drawPolysArray(ctx, polys) {
    ctx.beginPath();
    for (let i = 0; i < polys.length; i++) {
        ctx.moveTo(polys[i][0].x, polys[i][0].y);
        for(let j=1; j<polys[i].length; j++) ctx.lineTo(polys[i][j].x, polys[i][j].y);
        ctx.closePath();
    }
    ctx.fill();
}