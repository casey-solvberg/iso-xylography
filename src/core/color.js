export const COLOR_SEQUENCE = ['K', 'B', 'R', 'M', 'G', 'C', 'Y', 'W'];

export function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    if (max === min) {
        h = s = 0; 
    } else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    return [h * 360, s, l];
}

export function hslToRgb(h, s, l) {
    let r, g, b;
    h /= 360;
    if (s === 0) {
        r = g = b = l; 
    } else {
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1; if (t > 1) t -= 1;
            if (t < 1/6) return p + (q - p) * 6 * t;
            if (t < 1/2) return q;
            if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
            return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1/3); g = hue2rgb(p, q, h); b = hue2rgb(p, q, h - 1/3);
    }
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

export function getShiftedColors(hueShift) {
    const shiftHex = (r, g, b) => {
        let [h, s, l] = rgbToHsl(r, g, b);
        h = ((h + hueShift) % 360 + 360) % 360;
        let [r2, g2, b2] = hslToRgb(h, s, l);
        return `#${(1<<24 | r2<<16 | g2<<8 | b2).toString(16).slice(1).toUpperCase()}`;
    };
    return {
        K: { hex: '#000000', id: 'Black' },
        B: { hex: shiftHex(0, 0, 255), id: 'Blue' },
        M: { hex: shiftHex(255, 0, 255), id: 'Magenta' },
        R: { hex: shiftHex(255, 0, 0), id: 'Red' },
        Y: { hex: shiftHex(255, 255, 0), id: 'Yellow' },
        G: { hex: shiftHex(0, 255, 0), id: 'Green' },
        C: { hex: shiftHex(0, 255, 255), id: 'Cyan' },
        W: { hex: '#FFFFFF', id: 'White' }
    };
}

export function getRGB(imgData, w, h, cx, cy, dirX, dirY, normX, normY, stepLen, maxRadius) {
    let r = 0, g = 0, b = 0, count = 0;
    for(let u = -0.4; u <= 0.4; u += 0.4) {
        for(let v = 0.1; v <= 0.9; v += 0.4) {
            let px = Math.floor(cx + dirX * (u * stepLen) + normX * (v * maxRadius));
            let py = Math.floor(cy + dirY * (u * stepLen) + normY * (v * maxRadius));
            if(px >= 0 && px < w && py >= 0 && py < h) {
                let idx = (py * w + px) * 4; 
                r += imgData[idx]; g += imgData[idx+1]; b += imgData[idx+2]; count++;
            }
        }
    }
    if (count > 0) return { r: r/count, g: g/count, b: b/count };
    return { r: 255, g: 255, b: 255 }; 
}

export function decomposeColor(rgb) {
    let R = rgb.r, G = rgb.g, B = rgb.b;
    let K = 255 - Math.max(R, G, B);
    let W = Math.min(R, G, B);
    let r = R - W, g = G - W, b = B - W;
    
    let Y = Math.min(r, g);
    let C = Math.min(g, b);
    let M = Math.min(r, b);
    
    let r2 = r - Y - M;
    let g2 = g - Y - C;
    let b2 = b - C - M;

    return { K: K, W: W, R: r2, G: g2, B: b2, Y: Y, C: C, M: M };
}