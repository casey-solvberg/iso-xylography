import { clipPolygon, generateSmoothPolyline, getPolygonArea, drawPolysArray } from './core/math.js';
import { COLOR_SEQUENCE, rgbToHsl, hslToRgb, getShiftedColors, getRGB, decomposeColor } from './core/color.js';

const appState = { svgOutput: '', currentMode: 'mono' };

const PATTERNS = {
    '1_odd':   { type: 'D', phase: 'edges' }, '1_even':  { type: 'D', phase: 'center' }, '1i_odd':  { type: 'D', phase: 'quarters' }, '1i_even': { type: 'D', phase: 'all' },
    '2_odd':   { type: 'A', phase: 'edges' }, '2_even':  { type: 'A', phase: 'center' }, '2i_odd':  { type: 'A', phase: 'quarters' }, '2i_even': { type: 'A', phase: 'all' },
    '3_odd':   { type: 'V', phase: 'edges' }, '3_even':  { type: 'V', phase: 'center' }, '3i_odd':  { type: 'V', phase: 'quarters' }, '3i_even': { type: 'V', phase: 'all' }
};

// --- DOM REFERENCES ---
const imageInput = document.getElementById('imageInput');
const uploadMenuBtn = document.getElementById('uploadMenuBtn');
const uploadDropdown = document.getElementById('uploadDropdown');

const mainCanvas = document.getElementById('mainCanvas');
const ctxOut = mainCanvas.getContext('2d');
const hiddenCanvas = document.createElement('canvas');
const ctxHidden = hiddenCanvas.getContext('2d', { willReadFrequently: true });
const tempCanvas = document.createElement('canvas');
const ctxTemp = tempCanvas.getContext('2d');

let sourceImage = new Image();

// --- APP INITIALIZATION ---
function initApp() {
    populateCustomCombos();
    updatePaletteUI(0);
    loadExample('./Mona_Lisa.png');
}

// --- DROPDOWN & UPLOAD LOGIC ---
uploadMenuBtn.addEventListener('click', (e) => { e.stopPropagation(); uploadDropdown.classList.toggle('show'); });
window.addEventListener('click', (e) => { if (!uploadMenuBtn.contains(e.target)) uploadDropdown.classList.remove('show'); });
uploadDropdown.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', (e) => {
        e.preventDefault(); uploadDropdown.classList.remove('show');
        const val = e.target.getAttribute('data-val');
        if (val === 'custom') imageInput.click(); else loadExample(val);
    });
});

imageInput.addEventListener('change', (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => { loadFromDataURL(event.target.result); };
    reader.readAsDataURL(file);
});

function loadExample(url) {
    const img = new Image(); img.crossOrigin = "Anonymous";
    img.onload = () => { processLoadedImage(img); };
    img.src = url;
}

function loadFromDataURL(dataUrl) {
    const img = new Image();
    img.onload = () => { processLoadedImage(img); };
    img.src = dataUrl;
}

function processLoadedImage(img) {
    [hiddenCanvas, tempCanvas, mainCanvas].forEach(c => { c.width = img.width; c.height = img.height; });
    ctxHidden.drawImage(img, 0, 0);
    sourceImage.src = img.src;
    triggerRender();
}

// --- MODE SWITCHER ---
document.getElementById('btnMonoMode').addEventListener('click', (e) => switchMode('mono', e.target));
document.getElementById('btnColorMode').addEventListener('click', (e) => switchMode('color', e.target));

function switchMode(mode, targetBtn) {
    appState.currentMode = mode;
    document.querySelectorAll('.mode-btn').forEach(btn => btn.classList.remove('active'));
    targetBtn.classList.add('active');

    if (mode === 'mono') {
        document.getElementById('monoSpecificBlackControls').classList.add('active');
        document.getElementById('monoSpecificBlackControls').classList.remove('disabled-block');
        document.getElementById('colorSpecificControls').classList.remove('active');
        document.getElementById('colorSpecificControls').classList.add('disabled-block');
        document.getElementById('grayLayerContainer').style.display = 'block';
        document.getElementById('mainLayerTitle').textContent = 'Black Layer';
    } else {
        document.getElementById('monoSpecificBlackControls').classList.remove('active');
        document.getElementById('monoSpecificBlackControls').classList.add('disabled-block');
        document.getElementById('colorSpecificControls').classList.add('active');
        document.getElementById('colorSpecificControls').classList.remove('disabled-block');
        document.getElementById('grayLayerContainer').style.display = 'none';
        document.getElementById('mainLayerTitle').textContent = 'Color Pattern';
    }
    triggerRender();
}

// --- UI BINDINGS ---
let renderTimeout;
function populateCustomCombos() {
    const selects = document.querySelectorAll('.custom-combo-select');
    let optionsHTML = '';
    for (let r=1; r<=3; r++) for (let g=1; g<=3; g++) for (let b=1; b<=3; b++) optionsHTML += `<option value="${r}${g}${b}">${r}${g}${b}</option>`;
    selects.forEach(sel => sel.innerHTML = optionsHTML);
}

function syncControls(sourceEl) {
    const isRange = sourceEl.type === 'range';
    const baseName = isRange ? sourceEl.id.replace('Input', '') : sourceEl.id.replace('val-', '');
    const rangeEl = document.getElementById(`${baseName}Input`);
    const numEl = document.getElementById(`val-${baseName}`);
    if (!rangeEl || !numEl) return;

    let val = parseFloat(sourceEl.value); if (isNaN(val)) val = 0;

    if (baseName === 'hueShift') {
        val = ((val + 180) % 360 + 360) % 360 - 180;
        rangeEl.value = val; numEl.value = val;
        updatePaletteUI(val);
    } else {
        if (baseName.includes('MinThick')) { const maxR = document.getElementById(rangeEl.id.replace('Min', 'Max')); if (val > parseFloat(maxR.value)) val = parseFloat(maxR.value); }
        if (baseName.includes('MaxThick')) { const minR = document.getElementById(rangeEl.id.replace('Max', 'Min')); if (val < parseFloat(minR.value)) val = parseFloat(minR.value); }
        const absMin = parseFloat(rangeEl.min), absMax = parseFloat(rangeEl.max);
        
        if (isRange) {
            numEl.value = baseName.includes('Smooth') ? (val / 100).toFixed(2) : val;
        } else {
            if (baseName.includes('Smooth')) { val = Math.max(0, Math.min(1, val)); rangeEl.value = val * 100; numEl.value = val.toFixed(2); } 
            else { val = Math.max(absMin, Math.min(absMax, val)); rangeEl.value = val; numEl.value = val; }
        }
    }
}

const triggerRender = () => { clearTimeout(renderTimeout); renderTimeout = setTimeout(render, 50); };
document.querySelectorAll('.sidebar input[type="range"]').forEach(c => { c.addEventListener('input', (e) => { syncControls(e.target); triggerRender(); }); });
document.querySelectorAll('.sidebar input[type="number"]').forEach(c => { c.addEventListener('change', (e) => { syncControls(e.target); triggerRender(); }); });
document.querySelectorAll('.sidebar input[type="checkbox"], .sidebar input[type="radio"], .sidebar select').forEach(c => { c.addEventListener('change', triggerRender); });
document.querySelectorAll('.custom-combo-select').forEach(sel => { sel.addEventListener('change', (e) => { document.querySelector(`input[name="${sel.id.split('_')[0]}_combo"][value="custom"]`).checked = true; triggerRender(); }); });

function updatePaletteUI(hueShift) {
    const cmap = getShiftedColors(hueShift);
    ['C','M','Y','R','G','B'].forEach(k => document.getElementById(`swatch-${k}`).style.backgroundColor = cmap[k].hex);
}

function getActivePatterns(prefix) {
    const modeEl = document.querySelector(`input[name="${prefix}_mode"]:checked`);
    const comboEl = document.querySelector(`input[name="${prefix}_combo"]:checked`);
    const mode = modeEl ? modeEl.value : 'i_odd';
    let combo = comboEl ? comboEl.value : '123';
    if (combo === 'custom') combo = document.getElementById(`${prefix}_combo_select`).value;
    const getKey = (num) => mode.startsWith('i_') ? `${num}i_${mode.substring(2)}` : `${num}_${mode}`;
    return { 'Top': [getKey(combo[0])], 'Left': [getKey(combo[1])], 'Right': [getKey(combo[2])] };
}

// --- RENDER ENGINE ---
function render() {
    if (!sourceImage.src || !mainCanvas.width) return;

    const cols = parseInt(document.getElementById('colsInput').value);
    const rows = parseInt(document.getElementById('rowsInput').value);
    const cvsW = mainCanvas.width; const cvsH = mainCanvas.height;
    const imgData = ctxHidden.getImageData(0, 0, cvsW, cvsH).data;

    const hexW = cvsW / (cols * 2 + 1); const hexH = cvsH / (rows * 3 + 1);
    const diagLen = Math.hypot(hexW, hexH);
    const canvasBounds = [{ x: 0, y: 0 }, { x: cvsW, y: 0 }, { x: cvsW, y: cvsH }, { x: 0, y: cvsH }];

    // --- MONOCHROME GENERATOR ---
    const generateMonoPolygons = (prefix, options = { isInverse: false, isNegative: false }) => {
        const detailLevel = parseInt(document.getElementById(`${prefix}DetailInput`).value); 
        const stepLen = Math.max(cvsW, cvsH) / detailLevel; 
        const minThick = parseInt(document.getElementById(`${prefix}MinThickInput`).value) / 100;
        const maxThick = parseInt(document.getElementById(`${prefix}MaxThickInput`).value) / 100;
        const smoothFactor = parseFloat(document.getElementById(`val-${prefix}Smooth`).value);
        const activePatterns = getActivePatterns(prefix);
        const layerPolys = [];

        for (let r = -2; r <= rows + 2; r++) {
            for (let c = -2; c <= cols + 2; c++) {
                const gridX = (Math.abs(r) % 2 === 0) ? (c * 2 + 1) : (c * 2 + 2); const gridY = r * 3 + 2;
                const rhombuses = [
                    { patterns: activePatterns['Top'], pts: [[gridX,gridY], [gridX-1,gridY-1], [gridX,gridY-2], [gridX+1,gridY-1]] },
                    { patterns: activePatterns['Left'], pts: [[gridX,gridY], [gridX,gridY+2], [gridX-1,gridY+1], [gridX-1,gridY-1]] },
                    { patterns: activePatterns['Right'], pts: [[gridX,gridY], [gridX+1,gridY-1], [gridX+1,gridY+1], [gridX,gridY+2]] }
                ];

                rhombuses.forEach(rhomb => {
                    if (rhomb.patterns.length === 0) return;
                    const clipPoly = rhomb.pts.map(p => ({ x: p[0]*hexW, y: p[1]*hexH }));

                    rhomb.patterns.forEach(pKey => {
                        const config = PATTERNS[pKey]; if (!config) return;
                        let dir, norm, baseG;
                        if (config.type === 'V') { dir = { x: 0, y: 1 }; norm = { x: 1, y: 0 }; baseG = hexW; }
                        else if (config.type === 'D') { dir = { x: hexW/diagLen, y: -hexH/diagLen }; norm = { x: hexH/diagLen, y: hexW/diagLen }; baseG = 2 * hexW * hexH / diagLen; }
                        else if (config.type === 'A') { dir = { x: hexW/diagLen, y: hexH/diagLen }; norm = { x: hexH/diagLen, y: -hexW/diagLen }; baseG = 2 * hexW * hexH / diagLen; }

                        let pMin = Infinity, pMax = -Infinity;
                        rhomb.pts.forEach(p => { const proj = p[0]*hexW * norm.x + p[1]*hexH * norm.y; if (proj < pMin) pMin = proj; if (proj > pMax) pMax = proj; });
                        const lines = []; let baseRadius = baseG / 2; let spacing, offsets;
                        
                        if (config.phase === 'edges') { spacing = baseG; offsets = [0]; }
                        else if (config.phase === 'center') { spacing = baseG; offsets = [baseG / 2]; }
                        else if (config.phase === 'quarters') { spacing = baseG; offsets = [baseG / 4, 3 * baseG / 4]; baseRadius = baseG / 4; }
                        else if (config.phase === 'all') { spacing = baseG / 2; offsets = [0]; baseRadius = baseG / 4; }

                        offsets.forEach(offset => {
                            for (let k = Math.ceil((pMin - offset - 1e-4) / spacing); k <= Math.floor((pMax - offset + 1e-4) / spacing); k++) lines.push(k * spacing + offset);
                        });

                        [...new Set(lines.map(l => Number(l.toFixed(4))))].forEach(projVal => {
                            const pOrigin = { x: projVal * norm.x, y: projVal * norm.y };
                            const t_bounds = rhomb.pts.map(p => (p[0]*hexW - pOrigin.x)*dir.x + (p[1]*hexH - pOrigin.y)*dir.y);
                            const cPtsTop = [], cPtsBot = [];

                            for (let i = Math.floor(Math.min(...t_bounds) / stepLen) - 1; i <= Math.ceil(Math.max(...t_bounds) / stepLen) + 1; i++) {
                                const px = pOrigin.x + (i * stepLen) * dir.x; const py = pOrigin.y + (i * stepLen) * dir.y;
                                let rgbTop = getRGB(imgData, cvsW, cvsH, px, py, dir.x, dir.y, norm.x, norm.y, stepLen, baseRadius);
                                let rgbBot = getRGB(imgData, cvsW, cvsH, px, py, dir.x, dir.y, -norm.x, -norm.y, stepLen, baseRadius); 
                                
                                let brTop = (rgbTop.r*0.299 + rgbTop.g*0.587 + rgbTop.b*0.114) / 255;
                                let brBot = (rgbBot.r*0.299 + rgbBot.g*0.587 + rgbBot.b*0.114) / 255;

                                if (options.isNegative) { brTop = 1.0 - brTop; brBot = 1.0 - brBot; }
                                let thickTop, thickBot;
                                if (options.isInverse) {
                                    thickTop = Math.max(0, 1.0 - (minThick + brTop * (maxThick - minThick))) * baseRadius;
                                    thickBot = Math.max(0, 1.0 - (minThick + brBot * (maxThick - minThick))) * baseRadius;
                                } else {
                                    thickTop = (minThick + (1.0 - brTop) * (maxThick - minThick)) * baseRadius;
                                    thickBot = (minThick + (1.0 - brBot) * (maxThick - minThick)) * baseRadius;
                                }
                                cPtsTop.push({ x: px + norm.x * thickTop, y: py + norm.y * thickTop });
                                cPtsBot.push({ x: px - norm.x * thickBot, y: py - norm.y * thickBot });
                            }
                            let clippedPoly = clipPolygon([...generateSmoothPolyline(cPtsTop, smoothFactor), ...generateSmoothPolyline(cPtsBot, smoothFactor).reverse()], clipPoly);
                            if (clippedPoly.length > 2) { clippedPoly = clipPolygon(clippedPoly, canvasBounds); if (clippedPoly.length > 2) layerPolys.push(clippedPoly); }
                        });
                    });
                });
            }
        }
        return layerPolys;
    };

    // --- POLYCHROME GENERATOR ---
    const generateColorPolygons = (prefix) => {
        const detailLevel = parseInt(document.getElementById(`${prefix}DetailInput`).value); 
        const stepLen = Math.max(cvsW, cvsH) / detailLevel; 
        const hueShift = parseFloat(document.getElementById('val-hueShift').value) || 0;
        const activePatterns = getActivePatterns(prefix);
        const colorLayers = {}; COLOR_SEQUENCE.forEach(key => colorLayers[key] = []);

        for (let r = -2; r <= rows + 2; r++) {
            for (let c = -2; c <= cols + 2; c++) {
                const gridX = (Math.abs(r) % 2 === 0) ? (c * 2 + 1) : (c * 2 + 2); const gridY = r * 3 + 2;
                const rhombuses = [
                    { patterns: activePatterns['Top'], pts: [[gridX,gridY], [gridX-1,gridY-1], [gridX,gridY-2], [gridX+1,gridY-1]] },
                    { patterns: activePatterns['Left'], pts: [[gridX,gridY], [gridX,gridY+2], [gridX-1,gridY+1], [gridX-1,gridY-1]] },
                    { patterns: activePatterns['Right'], pts: [[gridX,gridY], [gridX+1,gridY-1], [gridX+1,gridY+1], [gridX,gridY+2]] }
                ];

                rhombuses.forEach(rhomb => {
                    if (rhomb.patterns.length === 0) return;
                    const clipPoly = rhomb.pts.map(p => ({ x: p[0]*hexW, y: p[1]*hexH }));

                    rhomb.patterns.forEach(pKey => {
                        const config = PATTERNS[pKey]; if (!config) return;
                        let dir, norm, baseG;
                        if (config.type === 'V') { dir = { x: 0, y: 1 }; norm = { x: 1, y: 0 }; baseG = hexW; }
                        else if (config.type === 'D') { dir = { x: hexW/diagLen, y: -hexH/diagLen }; norm = { x: hexH/diagLen, y: hexW/diagLen }; baseG = 2 * hexW * hexH / diagLen; }
                        else if (config.type === 'A') { dir = { x: hexW/diagLen, y: hexH/diagLen }; norm = { x: hexH/diagLen, y: -hexW/diagLen }; baseG = 2 * hexW * hexH / diagLen; }

                        let pMin = Infinity, pMax = -Infinity;
                        rhomb.pts.forEach(p => { const proj = p[0]*hexW * norm.x + p[1]*hexH * norm.y; if (proj < pMin) pMin = proj; if (proj > pMax) pMax = proj; });
                        const lines = []; let baseRadius = baseG / 2; let spacing, offsets;
                        
                        if (config.phase === 'edges') { spacing = baseG; offsets = [0]; }
                        else if (config.phase === 'center') { spacing = baseG; offsets = [baseG / 2]; }
                        else if (config.phase === 'quarters') { spacing = baseG; offsets = [baseG / 4, 3 * baseG / 4]; baseRadius = baseG / 4; }
                        else if (config.phase === 'all') { spacing = baseG / 2; offsets = [0]; baseRadius = baseG / 4; }

                        offsets.forEach(offset => {
                            for (let k = Math.ceil((pMin - offset - 1e-4) / spacing); k <= Math.floor((pMax - offset + 1e-4) / spacing); k++) lines.push(k * spacing + offset);
                        });

                        [...new Set(lines.map(l => Number(l.toFixed(4))))].forEach(projVal => {
                            const pOrigin = { x: projVal * norm.x, y: projVal * norm.y };
                            const t_bounds = rhomb.pts.map(p => (p[0]*hexW - pOrigin.x)*dir.x + (p[1]*hexH - pOrigin.y)*dir.y);
                            
                            const ptsTopMap = {}; const ptsBotMap = {};
                            COLOR_SEQUENCE.forEach(key => { ptsTopMap[key] = { inner: [], outer: [] }; ptsBotMap[key] = { inner: [], outer: [] }; });

                            for (let i = Math.floor(Math.min(...t_bounds) / stepLen) - 1; i <= Math.ceil(Math.max(...t_bounds) / stepLen) + 1; i++) {
                                const px = pOrigin.x + (i * stepLen) * dir.x; const py = pOrigin.y + (i * stepLen) * dir.y;
                                let rgbTop = getRGB(imgData, cvsW, cvsH, px, py, dir.x, dir.y, norm.x, norm.y, stepLen, baseRadius);
                                let rgbBot = getRGB(imgData, cvsW, cvsH, px, py, dir.x, dir.y, -norm.x, -norm.y, stepLen, baseRadius); 
                                
                                if (hueShift !== 0) {
                                    let [hT, sT, lT] = rgbToHsl(rgbTop.r, rgbTop.g, rgbTop.b); hT = ((hT - hueShift) % 360 + 360) % 360; 
                                    let [rT, gT, bT] = hslToRgb(hT, sT, lT); rgbTop = {r: rT, g: gT, b: bT};
                                    let [hB, sB, lB] = rgbToHsl(rgbBot.r, rgbBot.g, rgbBot.b); hB = ((hB - hueShift) % 360 + 360) % 360;
                                    let [rB, gB, bB] = hslToRgb(hB, sB, lB); rgbBot = {r: rB, g: gB, b: bB};
                                }

                                let decompTop = decomposeColor(rgbTop); let decompBot = decomposeColor(rgbBot);
                                let cumulTop = 0; let cumulBot = 0;

                                COLOR_SEQUENCE.forEach(key => {
                                    let rTopStart = cumulTop; let rTopEnd = cumulTop + (decompTop[key] / 255.0) * baseRadius; cumulTop = rTopEnd;
                                    ptsTopMap[key].inner.push({ x: px + norm.x * rTopStart, y: py + norm.y * rTopStart });
                                    ptsTopMap[key].outer.push({ x: px + norm.x * rTopEnd, y: py + norm.y * rTopEnd });

                                    let rBotStart = cumulBot; let rBotEnd = cumulBot + (decompBot[key] / 255.0) * baseRadius; cumulBot = rBotEnd;
                                    ptsBotMap[key].inner.push({ x: px - norm.x * rBotStart, y: py - norm.y * rBotStart });
                                    ptsBotMap[key].outer.push({ x: px - norm.x * rBotEnd, y: py - norm.y * rBotEnd });
                                });
                            }

                            COLOR_SEQUENCE.forEach(key => {
                                let polyTop = [...ptsTopMap[key].inner, ...ptsTopMap[key].outer.reverse()];
                                let polyBot = [...ptsBotMap[key].inner, ...ptsBotMap[key].outer.reverse()];
                                if (getPolygonArea(polyTop) > 0.1) { let c = clipPolygon(polyTop, clipPoly); if (c.length > 2) { c = clipPolygon(c, canvasBounds); if (c.length > 2) colorLayers[key].push(c); } }
                                if (getPolygonArea(polyBot) > 0.1) { let c = clipPolygon(polyBot, clipPoly); if (c.length > 2) { c = clipPolygon(c, canvasBounds); if (c.length > 2) colorLayers[key].push(c); } }
                            });
                        });
                    });
                });
            }
        }
        return colorLayers;
    };

    // --- EXECUTE & COMPOSITE ---
    
    // 1. Create an array of coordinates for all base hexagons
    const hexPolys = [];
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const gridX = (Math.abs(r) % 2 === 0) ? (c * 2 + 1) : (c * 2 + 2); 
            const gridY = r * 3 + 2;
            hexPolys.push([
                { x: gridX * hexW, y: (gridY - 2) * hexH },
                { x: (gridX - 1) * hexW, y: (gridY - 1) * hexH },
                { x: (gridX - 1) * hexW, y: (gridY + 1) * hexH },
                { x: gridX * hexW, y: (gridY + 2) * hexH },
                { x: (gridX + 1) * hexW, y: (gridY + 1) * hexH },
                { x: (gridX + 1) * hexW, y: (gridY - 1) * hexH }
            ]);
        }
    }
    
    // 2. Form a path for visual clipping on the canvas (PNG/Screen)
    let hexPathD = '';
    hexPolys.forEach(poly => {
        hexPathD += `M ${poly.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' L ')} Z `;
    });

    ctxOut.globalCompositeOperation = 'source-over';
    ctxOut.clearRect(0, 0, cvsW, cvsH); 
    
    ctxOut.save(); 
    
    const isCropped = document.getElementById('cropToHex')?.checked;
    if (isCropped) {
        const clipPath2D = new Path2D(hexPathD);
        ctxOut.clip(clipPath2D); 
    }

    ctxOut.fillStyle = '#ffffff';
    ctxOut.fillRect(0, 0, cvsW, cvsH); 

    let svgStr = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${cvsW} ${cvsH}">\n`;
    
    if (isCropped) {
        svgStr += `  <g id="Layer_Crop_Hexagons" fill="#FFFFFF" stroke="none">\n`;
        hexPolys.forEach(poly => {
            svgStr += `    <polygon points="${poly.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')}" />\n`;
        });
        svgStr += `  </g>\n`;
    }

    // --- RENDER LAYERS ---
    if (appState.currentMode === 'mono') {
        const isBlackEnabled = document.getElementById('enableBlack').checked;
        const isGrayEnabled = document.getElementById('enableGray').checked;
        const grayRenderMode = document.getElementById('grayRenderMode').value;
        const grayColor = '#7f7f7f';

        let blackPolys = [], grayPolysOriginal = [], grayPolysGaps = [], grayPolysNegative = [];
        if (isBlackEnabled) blackPolys = generateMonoPolygons('black');
        if (isGrayEnabled) {
            grayPolysOriginal = generateMonoPolygons('gray');
            if (grayRenderMode === 'checkered') grayPolysGaps = generateMonoPolygons('gray', { isInverse: true });
            else grayPolysNegative = generateMonoPolygons('gray', { isNegative: true });
        }

        // --- 1. Gray on White (Bottom layer, goes under black) ---
        if (isGrayEnabled && document.getElementById('grayOnWhite').checked) { 
            ctxOut.fillStyle = grayColor; drawPolysArray(ctxOut, grayPolysOriginal); 
        }
        
        // --- 2. Black layer ---
        if (isBlackEnabled) { 
            ctxOut.fillStyle = '#000000'; drawPolysArray(ctxOut, blackPolys); 
        }

        // --- 3. Gray on Black (Top layer mask, goes only over black) ---
        if (isGrayEnabled && isBlackEnabled && document.getElementById('grayOnBlack').checked) {
            ctxTemp.clearRect(0, 0, cvsW, cvsH);
            if (grayRenderMode === 'checkered') {
                ctxTemp.globalCompositeOperation = 'source-over'; ctxTemp.fillStyle = '#000000'; drawPolysArray(ctxTemp, blackPolys);
                ctxTemp.globalCompositeOperation = 'destination-out'; drawPolysArray(ctxTemp, grayPolysGaps);
                ctxTemp.globalCompositeOperation = 'source-in'; ctxTemp.fillStyle = grayColor; ctxTemp.fillRect(0, 0, cvsW, cvsH);
            } else {
                ctxTemp.globalCompositeOperation = 'source-over'; ctxTemp.fillStyle = '#000000'; drawPolysArray(ctxTemp, blackPolys);
                ctxTemp.globalCompositeOperation = 'source-in'; ctxTemp.fillStyle = grayColor; drawPolysArray(ctxTemp, grayPolysNegative);
            }
            ctxOut.globalCompositeOperation = 'source-over'; ctxOut.drawImage(tempCanvas, 0, 0);
        }

        // --- WRITE LAYERS TO SVG ---
        if (grayRenderMode === 'checkered') {
            if (isGrayEnabled) { svgStr += `  <g id="Layer_Gray" fill="${grayColor}">\n`; grayPolysOriginal.forEach(poly => { svgStr += `    <polygon points="${poly.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')}" />\n`; }); svgStr += `  </g>\n`; }
            if (isBlackEnabled) { svgStr += `  <g id="Layer_Black" fill="#000000">\n`; blackPolys.forEach(poly => { svgStr += `    <polygon points="${poly.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')}" />\n`; }); svgStr += `  </g>\n`; }
        } else {
            if (isGrayEnabled) { svgStr += `  <g id="Layer_Gray_Original" fill="${grayColor}">\n`; grayPolysOriginal.forEach(poly => { svgStr += `    <polygon points="${poly.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')}" />\n`; }); svgStr += `  </g>\n`; }
            if (isBlackEnabled) { svgStr += `  <g id="Layer_Black" fill="#000000">\n`; blackPolys.forEach(poly => { svgStr += `    <polygon points="${poly.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')}" />\n`; }); svgStr += `  </g>\n`; }
            if (isGrayEnabled) { svgStr += `  <g id="Layer_Gray_Negative" fill="${grayColor}">\n`; grayPolysNegative.forEach(poly => { svgStr += `    <polygon points="${poly.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')}" />\n`; }); svgStr += `  </g>\n`; }
        }
    } else {
        if (document.getElementById('enableBlack').checked) {
            const colorLayers = generateColorPolygons('black');
            const dynamicColorMap = getShiftedColors(parseFloat(document.getElementById('val-hueShift').value) || 0);
            COLOR_SEQUENCE.forEach(key => {
                if (key === 'W') return; 
                ctxOut.fillStyle = dynamicColorMap[key].hex; drawPolysArray(ctxOut, colorLayers[key]);
            });
            COLOR_SEQUENCE.forEach(key => {
                if (colorLayers[key].length === 0) return;
                svgStr += `  <g id="Layer_${dynamicColorMap[key].id}" fill="${dynamicColorMap[key].hex}">\n`;
                colorLayers[key].forEach(poly => { svgStr += `    <polygon points="${poly.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')}" />\n`; });
                svgStr += `  </g>\n`;
            });
        }
    }

    ctxOut.restore(); 

    const debugOpacity = parseInt(document.getElementById('debugOpacityInput').value) / 100;
    
    if (document.getElementById('showInitialHex')?.checked) {
        ctxOut.strokeStyle = `rgba(255, 165, 0, ${debugOpacity})`; 
        ctxOut.lineWidth = 1;
        const p2d = new Path2D(hexPathD);
        ctxOut.stroke(p2d); 
    }

    if (document.getElementById('showRectGrid').checked) {
        ctxOut.strokeStyle = `rgba(0, 0, 0, ${debugOpacity})`; ctxOut.lineWidth = 1; ctxOut.beginPath();
        for(let u = -2; u <= cols * 2 + 4; u++) { ctxOut.moveTo(u * hexW, -2 * hexH); ctxOut.lineTo(u * hexW, cvsH + 2 * hexH); }
        for(let v = -2; v <= rows * 3 + 4; v++) { ctxOut.moveTo(-2 * hexW, v * hexH); ctxOut.lineTo(cvsW + 2 * hexW, v * hexH); }
        ctxOut.stroke();
    }

    if (document.getElementById('showSelectors').checked) {
        for (let r = -2; r <= rows + 2; r++) {
            for (let c = -2; c <= cols + 2; c++) {
                const gridX = (Math.abs(r) % 2 === 0) ? (c * 2 + 1) : (c * 2 + 2); const gridY = r * 3 + 2;
                [{ color: `rgba(244, 67, 54, ${debugOpacity})`, pts: [[gridX,gridY], [gridX-1,gridY-1], [gridX,gridY-2], [gridX+1,gridY-1]] },
                 { color: `rgba(76, 175, 80, ${debugOpacity})`, pts: [[gridX,gridY], [gridX,gridY+2], [gridX-1,gridY+1], [gridX-1,gridY-1]] },
                 { color: `rgba(33, 150, 243, ${debugOpacity})`, pts: [[gridX,gridY], [gridX+1,gridY-1], [gridX+1,gridY+1], [gridX,gridY+2]] }
                ].forEach(rhomb => {
                    ctxOut.beginPath(); ctxOut.moveTo(rhomb.pts[0][0]*hexW, rhomb.pts[0][1]*hexH);
                    rhomb.pts.slice(1).forEach(p => ctxOut.lineTo(p[0]*hexW, p[1]*hexH));
                    ctxOut.closePath(); ctxOut.fillStyle = rhomb.color; ctxOut.fill();
                });
            }
        }
    }
    
    if (document.getElementById('showHexGrid').checked) {
        ctxOut.strokeStyle = `rgba(33, 150, 243, ${debugOpacity})`; ctxOut.lineWidth = 1;
        for (let r = -2; r <= rows + 2; r++) {
            for (let c = -2; c <= cols + 2; c++) {
                const gridX = (Math.abs(r) % 2 === 0) ? (c * 2 + 1) : (c * 2 + 2); const gridY = r * 3 + 2;
                [{ pts: [[gridX,gridY], [gridX-1,gridY-1], [gridX,gridY-2], [gridX+1,gridY-1]] },
                 { pts: [[gridX,gridY], [gridX,gridY+2], [gridX-1,gridY+1], [gridX-1,gridY-1]] },
                 { pts: [[gridX,gridY], [gridX+1,gridY-1], [gridX+1,gridY+1], [gridX,gridY+2]] }
                ].forEach(rhomb => {
                    ctxOut.beginPath(); ctxOut.moveTo(rhomb.pts[0][0]*hexW, rhomb.pts[0][1]*hexH);
                    rhomb.pts.slice(1).forEach(p => ctxOut.lineTo(p[0]*hexW, p[1]*hexH));
                    ctxOut.closePath(); ctxOut.stroke();
                });
            }
        }
    }
    
    svgStr += `</svg>`; 
    appState.svgOutput = svgStr;
} // END OF RENDER FUNCTION

function getExportFilename(extension) {
    const cols = document.getElementById('colsInput').value; 
    const rows = document.getElementById('rowsInput').value;
    const modeMap = { 'i_odd': 'A', 'i_even': 'B', 'odd': 'C', 'even': 'D' };
    let filename = appState.currentMode === 'mono' ? `xylo_${cols}x${rows}` : `xylo_color_${cols}x${rows}_H${document.getElementById('val-hueShift').value}`;
    
    if (document.getElementById('enableBlack').checked) {
        const bMode = document.querySelector('input[name="black_mode"]:checked').value;
        let bCombo = document.querySelector('input[name="black_combo"]:checked').value;
        if (bCombo === 'custom') bCombo = document.getElementById('black_combo_select').value;
        filename += `_${modeMap[bMode]}-${bCombo}`;
    }
    if (appState.currentMode === 'mono' && document.getElementById('enableGray').checked) {
        const gMode = document.querySelector('input[name="gray_mode"]:checked').value;
        let gCombo = document.querySelector('input[name="gray_combo"]:checked').value;
        if (gCombo === 'custom') gCombo = document.getElementById('gray_combo_select').value;
        filename += `_${modeMap[gMode]}-${gCombo}_${document.getElementById('grayRenderMode').value === 'checkered' ? 'CHK' : 'CNT'}`;
    }
    return `${filename}.${extension}`;
}

document.getElementById('downloadPngBtn').addEventListener('click', () => {
    const link = document.createElement('a'); link.download = getExportFilename('png'); 
    link.href = mainCanvas.toDataURL('image/png'); link.click();
});

document.getElementById('downloadSvgBtn').addEventListener('click', () => {
    if (!appState.svgOutput) return;
    const blob = new Blob([appState.svgOutput], {type: 'image/svg+xml;charset=utf-8'});
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); 
    link.href = url; link.download = getExportFilename('svg'); link.click(); URL.revokeObjectURL(url);
});

initApp();
// --- ПОТОКОВАЯ УПАКОВКА В ZIP БЕЗ НАГРУЗКИ НА ОЗУ ---
const CRC_TABLE = new Uint32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    return c >>> 0;
});

function crc32(buf) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xFF];
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

class StreamingZipWriter {
    constructor(writableStream) {
        this.stream = writableStream;
        this.offset = 0;
        this.files = [];
        this.encoder = new TextEncoder();
    }

    async addFile(filename, uint8Data) {
        const nameBytes = this.encoder.encode(filename);
        const crc = crc32(uint8Data);
        const size = uint8Data.byteLength;

        const localHeader = new Uint8Array(30 + nameBytes.length);
        const view = new DataView(localHeader.buffer);
        view.setUint32(0, 0x04034b50, true); // Local file header signature
        view.setUint16(4, 20, true);         // Version needed
        view.setUint16(6, 0, true);          // Flags
        view.setUint16(8, 0, true);          // Compression: 0 (STORE - без сжатия, т.к. PNG уже сжат)
        view.setUint32(14, crc, true);       // CRC-32
        view.setUint32(18, size, true);      // Compressed size
        view.setUint32(22, size, true);      // Uncompressed size
        view.setUint16(26, nameBytes.length, true);
        localHeader.set(nameBytes, 30);

        await this.stream.write(localHeader);
        await this.stream.write(uint8Data);

        this.files.push({ nameBytes, crc, size, offset: this.offset });
        this.offset += localHeader.byteLength + size;
    }

    async finalize() {
        const cdStart = this.offset;
        for (const f of this.files) {
            const cdHeader = new Uint8Array(46 + f.nameBytes.length);
            const view = new DataView(cdHeader.buffer);
            view.setUint32(0, 0x02014b50, true); // Central directory signature
            view.setUint16(4, 20, true);
            view.setUint16(6, 20, true);
            view.setUint32(16, f.crc, true);
            view.setUint32(20, f.size, true);
            view.setUint32(24, f.size, true);
            view.setUint16(28, f.nameBytes.length, true);
            view.setUint32(42, f.offset, true);
            cdHeader.set(f.nameBytes, 46);

            await this.stream.write(cdHeader);
            this.offset += cdHeader.byteLength;
        }

        const cdSize = this.offset - cdStart;
        const eocd = new Uint8Array(22);
        const eocdView = new DataView(eocd.buffer);
        eocdView.setUint32(0, 0x06054b50, true); // End of central directory
        eocdView.setUint16(8, this.files.length, true);
        eocdView.setUint16(10, this.files.length, true);
        eocdView.setUint32(12, cdSize, true);
        eocdView.setUint32(16, cdStart, true);

        await this.stream.write(eocd);
        await this.stream.close();
    }
}

// Вспомогательная конвертация массива полигонов в быстрый объект Path2D
function polysToPath2D(polys) {
    const path = new Path2D();
    for (let i = 0; i < polys.length; i++) {
        const p = polys[i];
        path.moveTo(p[0].x, p[0].y);
        for (let j = 1; j < p.length; j++) path.lineTo(p[j].x, p[j].y);
        path.closePath();
    }
    return path;
}

// Генерация геометрии одного слоя для конкретного (mode, combo)
function buildMonoPolysForState(prefix, mode, combo, isNegative = false) {
    const cols = parseInt(document.getElementById('colsInput').value);
    const rows = parseInt(document.getElementById('rowsInput').value);
    const cvsW = mainCanvas.width, cvsH = mainCanvas.height;
    const imgData = ctxHidden.getImageData(0, 0, cvsW, cvsH).data;
    const hexW = cvsW / (cols * 2 + 1), hexH = cvsH / (rows * 3 + 1);
    const diagLen = Math.hypot(hexW, hexH);
    const canvasBounds = [{ x: 0, y: 0 }, { x: cvsW, y: 0 }, { x: cvsW, y: cvsH }, { x: 0, y: cvsH }];

    const detailLevel = parseInt(document.getElementById(`${prefix}DetailInput`).value);
    const stepLen = Math.max(cvsW, cvsH) / detailLevel;
    const minThick = parseInt(document.getElementById(`${prefix}MinThickInput`).value) / 100;
    const maxThick = parseInt(document.getElementById(`${prefix}MaxThickInput`).value) / 100;
    const smoothFactor = parseFloat(document.getElementById(`val-${prefix}Smooth`).value);

    const getKey = (num) => mode.startsWith('i_') ? `${num}i_${mode.substring(2)}` : `${num}_${mode}`;
    const activePatterns = { 'Top': [getKey(combo[0])], 'Left': [getKey(combo[1])], 'Right': [getKey(combo[2])] };
    const layerPolys = [];

    for (let r = -2; r <= rows + 2; r++) {
        for (let c = -2; c <= cols + 2; c++) {
            const gridX = (Math.abs(r) % 2 === 0) ? (c * 2 + 1) : (c * 2 + 2);
            const gridY = r * 3 + 2;
            const rhombuses = [
                { patterns: activePatterns['Top'], pts: [[gridX,gridY], [gridX-1,gridY-1], [gridX,gridY-2], [gridX+1,gridY-1]] },
                { patterns: activePatterns['Left'], pts: [[gridX,gridY], [gridX,gridY+2], [gridX-1,gridY+1], [gridX-1,gridY-1]] },
                { patterns: activePatterns['Right'], pts: [[gridX,gridY], [gridX+1,gridY-1], [gridX+1,gridY+1], [gridX,gridY+2]] }
            ];

            rhombuses.forEach(rhomb => {
                const clipPoly = rhomb.pts.map(p => ({ x: p[0]*hexW, y: p[1]*hexH }));
                rhomb.patterns.forEach(pKey => {
                    const config = PATTERNS[pKey];
                    let dir, norm, baseG;
                    if (config.type === 'V') { dir = { x: 0, y: 1 }; norm = { x: 1, y: 0 }; baseG = hexW; }
                    else if (config.type === 'D') { dir = { x: hexW/diagLen, y: -hexH/diagLen }; norm = { x: hexH/diagLen, y: hexW/diagLen }; baseG = 2 * hexW * hexH / diagLen; }
                    else if (config.type === 'A') { dir = { x: hexW/diagLen, y: hexH/diagLen }; norm = { x: hexH/diagLen, y: -hexW/diagLen }; baseG = 2 * hexW * hexH / diagLen; }

                    let pMin = Infinity, pMax = -Infinity;
                    rhomb.pts.forEach(p => { const proj = p[0]*hexW * norm.x + p[1]*hexH * norm.y; if (proj < pMin) pMin = proj; if (proj > pMax) pMax = proj; });
                    const lines = []; let baseRadius = baseG / 2; let spacing, offsets;

                    if (config.phase === 'edges') { spacing = baseG; offsets = [0]; }
                    else if (config.phase === 'center') { spacing = baseG; offsets = [baseG / 2]; }
                    else if (config.phase === 'quarters') { spacing = baseG; offsets = [baseG / 4, 3 * baseG / 4]; baseRadius = baseG / 4; }
                    else if (config.phase === 'all') { spacing = baseG / 2; offsets = [0]; baseRadius = baseG / 4; }

                    offsets.forEach(offset => {
                        for (let k = Math.ceil((pMin - offset - 1e-4) / spacing); k <= Math.floor((pMax - offset + 1e-4) / spacing); k++) lines.push(k * spacing + offset);
                    });

                    [...new Set(lines.map(l => Number(l.toFixed(4))))].forEach(projVal => {
                        const pOrigin = { x: projVal * norm.x, y: projVal * norm.y };
                        const t_bounds = rhomb.pts.map(p => (p[0]*hexW - pOrigin.x)*dir.x + (p[1]*hexH - pOrigin.y)*dir.y);
                        const cPtsTop = [], cPtsBot = [];

                        for (let i = Math.floor(Math.min(...t_bounds) / stepLen) - 1; i <= Math.ceil(Math.max(...t_bounds) / stepLen) + 1; i++) {
                            const px = pOrigin.x + (i * stepLen) * dir.x, py = pOrigin.y + (i * stepLen) * dir.y;
                            let rgbTop = getRGB(imgData, cvsW, cvsH, px, py, dir.x, dir.y, norm.x, norm.y, stepLen, baseRadius);
                            let rgbBot = getRGB(imgData, cvsW, cvsH, px, py, dir.x, dir.y, -norm.x, -norm.y, stepLen, baseRadius);
                            let brTop = (rgbTop.r*0.299 + rgbTop.g*0.587 + rgbTop.b*0.114) / 255;
                            let brBot = (rgbBot.r*0.299 + rgbBot.g*0.587 + rgbBot.b*0.114) / 255;
                            if (isNegative) { brTop = 1.0 - brTop; brBot = 1.0 - brBot; }

                            const thickTop = (minThick + (1.0 - brTop) * (maxThick - minThick)) * baseRadius;
                            const thickBot = (minThick + (1.0 - brBot) * (maxThick - minThick)) * baseRadius;
                            cPtsTop.push({ x: px + norm.x * thickTop, y: py + norm.y * thickTop });
                            cPtsBot.push({ x: px - norm.x * thickBot, y: py - norm.y * thickBot });
                        }
                        let clippedPoly = clipPolygon([...generateSmoothPolyline(cPtsTop, smoothFactor), ...generateSmoothPolyline(cPtsBot, smoothFactor).reverse()], clipPoly);
                        if (clippedPoly.length > 2) {
                            clippedPoly = clipPolygon(clippedPoly, canvasBounds);
                            if (clippedPoly.length > 2) layerPolys.push(clippedPoly);
                        }
                    });
                });
            });
        }
    }
    return polysToPath2D(layerPolys);
}

// --- ОБРАБОТЧИК КНОПКИ ГЕНЕРАЦИИ 552 КАРТИНОК ---
document.getElementById('downloadBatchZipBtn').addEventListener('click', async () => {
    if (!window.showSaveFilePicker) {
        alert('Ваш браузер не поддерживает потоковую запись на диск (File System Access API). Пожалуйста, откройте приложение в Chrome, Edge или Opera.');
        return;
    }

    const btn = document.getElementById('downloadBatchZipBtn');
    const cols = parseInt(document.getElementById('colsInput').value);
    const rows = parseInt(document.getElementById('rowsInput').value);
    const cvsW = mainCanvas.width, cvsH = mainCanvas.height;

    // 1. Запрашиваем место сохранения ZIP-файла на диске
    let fileHandle;
    try {
        fileHandle = await window.showSaveFilePicker({
            suggestedName: `xylo_${cols}x${rows}_552_CNT.zip`,
            types: [{ description: 'ZIP Archive', accept: { 'application/zip': ['.zip'] } }]
        });
    } catch (e) {
        return; // Пользователь отменил выбор файла
    }

    btn.disabled = true;
    const writable = await fileHandle.createWritable();
    const zip = new StreamingZipWriter(writable);

    // 2. Формируем 24 состояния (4 Mode * 6 Combo без повторений цифр)
    const modes = ['i_odd', 'i_even', 'odd', 'even'];
    const modeMap = { 'i_odd': 'A', 'i_even': 'B', 'odd': 'C', 'even': 'D' };
    const combos = ['123', '132', '213', '231', '312', '321'];

    const states = [];
    for (const mode of modes) {
        for (const combo of combos) {
            states.push({ key: `${modeMap[mode]}-${combo}`, mode, combo });
        }
    }

    // 3. Предрасчёт 24 геометрий
    const blackCache = new Map();
    const grayCache = new Map();

    for (let idx = 0; idx < states.length; idx++) {
        const s = states[idx];
        btn.textContent = `⏳ Предрасчёт геометрии: ${idx + 1} / ${states.length}...`;
        await new Promise(r => setTimeout(r, 0)); // Даём обновиться UI

        blackCache.set(s.key, buildMonoPolysForState('black', s.mode, s.combo, false));
        grayCache.set(s.key, {
            orig: buildMonoPolysForState('gray', s.mode, s.combo, false),
            neg:  buildMonoPolysForState('gray', s.mode, s.combo, true)
        });
    }

    // Подготовка контура обрезки гексагонов (если включен Crop to Hexagons)
    const isCropped = document.getElementById('cropToHex')?.checked;
    const showOnWhite = document.getElementById('grayOnWhite').checked;
    const showOnBlack = document.getElementById('grayOnBlack').checked;
    const grayColor = '#7f7f7f';

    let clipPath2D = null;
    if (isCropped) {
        const hexW = cvsW / (cols * 2 + 1), hexH = cvsH / (rows * 3 + 1);
        let hexPathD = '';
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const gridX = (Math.abs(r) % 2 === 0) ? (c * 2 + 1) : (c * 2 + 2), gridY = r * 3 + 2;
                const poly = [
                    { x: gridX * hexW, y: (gridY - 2) * hexH }, { x: (gridX - 1) * hexW, y: (gridY - 1) * hexH },
                    { x: (gridX - 1) * hexW, y: (gridY + 1) * hexH }, { x: gridX * hexW, y: (gridY + 2) * hexH },
                    { x: (gridX + 1) * hexW, y: (gridY + 1) * hexH }, { x: (gridX + 1) * hexW, y: (gridY - 1) * hexH }
                ];
                hexPathD += `M ${poly.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' L ')} Z `;
            }
        }
        clipPath2D = new Path2D(hexPathD);
    }

    // 4. Основной цикл рендера и записи 552 PNG-файлов
    let count = 0;
    const total = states.length * (states.length - 1); // 552

    for (const bState of states) {
        const blackPath = blackCache.get(bState.key);

        for (const gState of states) {
            if (bState.key === gState.key) continue; // Отсекаем полностью совпадающие комбинации

            const grayPaths = grayCache.get(gState.key);

            ctxOut.globalCompositeOperation = 'source-over';
            ctxOut.clearRect(0, 0, cvsW, cvsH);
            ctxOut.save();

            if (clipPath2D) ctxOut.clip(clipPath2D);

            ctxOut.fillStyle = '#ffffff';
            ctxOut.fillRect(0, 0, cvsW, cvsH);

            // 1. Gray on White
            if (showOnWhite) {
                ctxOut.fillStyle = grayColor;
                ctxOut.fill(grayPaths.orig);
            }

            // 2. Black Layer
            ctxOut.fillStyle = '#000000';
            ctxOut.fill(blackPath);

            // 3. Gray on Black (Continuous)
            if (showOnBlack) {
                ctxTemp.clearRect(0, 0, cvsW, cvsH);
                ctxTemp.globalCompositeOperation = 'source-over';
                ctxTemp.fillStyle = '#000000';
                ctxTemp.fill(blackPath);

                ctxTemp.globalCompositeOperation = 'source-in';
                ctxTemp.fillStyle = grayColor;
                ctxTemp.fill(grayPaths.neg);

                ctxOut.globalCompositeOperation = 'source-over';
                ctxOut.drawImage(tempCanvas, 0, 0);
            }

            ctxOut.restore();

            // Кодируем холст в PNG Blob и сразу сбрасываем на диск
            const blob = await new Promise(res => mainCanvas.toBlob(res, 'image/png'));
            const uint8 = new Uint8Array(await blob.arrayBuffer());
            const filename = `xylo_${cols}x${rows}_${bState.key}_${gState.key}_CNT.png`;

            await zip.addFile(filename, uint8);

            count++;
            if (count % 20 === 0 || count === total) {
                btn.textContent = `📦 Сохранено: ${count} / ${total}`;
            }
        }
    }

    await zip.finalize();
    btn.disabled = false;
    btn.textContent = `✅ Готово! ${total} PNG сохранены`;
});