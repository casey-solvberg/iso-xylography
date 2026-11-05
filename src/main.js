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
// ============================================================================
// 16 СЕРЫХ УЗОРОВ × ТОП-2 ЧЁРНЫХ = 32 ПУТИ (10 СФИРОТ + 22 БУКВЫ)
// ============================================================================

const SEFIROT_SYMBOLS = [
    "א'", "ב'", "ג'", "ד'", "ה'", "ו'", "ז'", "ח'", "ט'", "י'",
    "א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט", "י", "כ",
    "ל", "מ", "נ", "ס", "ע", "פ", "צ", "ק", "ר", "ש", "ת"
];

// 8 отобранных комбинаций для Серого слоя (в режимах A и B дают 16 Серых узоров)
const GRAY_8_COMBOS = ['112', '132', '212', '213', '312', '313', '321', '332'];
const GRAY_MODES = ['A', 'B'];

// Для Чёрного слоя перебираем абсолютно все 4 режима и все 27 комбинаций (111..333)
const ALL_BLACK_MODES = ['A', 'B', 'C', 'D'];
const ALL_27_COMBOS = [];
for (let r = 1; r <= 3; r++) {
    for (let g = 1; g <= 3; g++) {
        for (let b = 1; b <= 3; b++) {
            ALL_27_COMBOS.push(`${r}${g}${b}`);
        }
    }
}

const RANK_MODE_REV = { 'A': 'i_odd', 'B': 'i_even', 'C': 'odd', 'D': 'even' };
const BASIC_6_COMBOS = new Set(['123', '132', '213', '231', '312', '321']);
const FACE_DIAG = ['3', '1', '2'];

// Подбор фона, комплиментарного СЕРОМУ слою (и максимально разведённого с Чёрным)
function getComplementaryBgForGray(gm, gc, bc) {
    // Противоположная фаза к Серому слою (для A -> B, для B -> A)
    const bgMode = (gm === 'A') ? 'B' : 'A';

    // Все комбинации (без 111/222/333), которые ни на одной грани не совпадают с Серым слоем
    const candidates = ALL_27_COMBOS.filter(c =>
        !(c[0] === c[1] && c[1] === c[2]) &&
        c[0] !== gc[0] && c[1] !== gc[1] && c[2] !== gc[2]
    );

    const scored = candidates.map(c => {
        const blackOverlap = (c[0] === bc[0] ? 1 : 0) + (c[1] === bc[1] ? 1 : 0) + (c[2] === bc[2] ? 1 : 0);
        const uniqueDigits = new Set(c).size; // 3 = все 3 грани разные
        const diagCount = (c[0] === FACE_DIAG[0] ? 1 : 0) + (c[1] === FACE_DIAG[1] ? 1 : 0) + (c[2] === FACE_DIAG[2] ? 1 : 0);
        return { combo: c, blackOverlap, uniqueDigits, diagCount };
    });

    scored.sort((a, b) =>
        (a.blackOverlap - b.blackOverlap) ||
        (b.uniqueDigits - a.uniqueDigits) ||
        (a.diagCount - b.diagCount)
    );

    const bgCombo = scored[0].combo;
    return { mode: bgMode, combo: bgCombo, key: `${bgMode}-${bgCombo}`, shortTag: `BG${bgCombo}` };
}

// --- CRC32 и сборка ZIP ---
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

function buildZipBlob(filesList) {
    const encoder = new TextEncoder();
    const chunks = [];
    const centralDir = [];
    let offset = 0;

    for (const file of filesList) {
        const nameBytes = encoder.encode(file.name);
        const dataBytes = encoder.encode(file.content);
        const crc = crc32(dataBytes);
        const size = dataBytes.byteLength;

        const localHeader = new Uint8Array(30 + nameBytes.length);
        const lv = new DataView(localHeader.buffer);
        lv.setUint32(0, 0x04034b50, true);
        lv.setUint16(4, 20, true);
        lv.setUint16(6, 0x0800, true); // UTF-8 flag для корректных букв иврита в именах файлов
        lv.setUint16(8, 0, true);
        lv.setUint32(14, crc, true);
        lv.setUint32(18, size, true);
        lv.setUint32(22, size, true);
        lv.setUint16(26, nameBytes.length, true);
        localHeader.set(nameBytes, 30);

        chunks.push(localHeader, dataBytes);

        const cdHeader = new Uint8Array(46 + nameBytes.length);
        const cv = new DataView(cdHeader.buffer);
        cv.setUint32(0, 0x02014b50, true);
        cv.setUint16(4, 20, true);
        cv.setUint16(6, 20, true);
        cv.setUint16(8, 0x0800, true); // UTF-8 flag
        cv.setUint32(16, crc, true);
        cv.setUint32(20, size, true);
        cv.setUint32(24, size, true);
        cv.setUint16(28, nameBytes.length, true);
        cv.setUint32(42, offset, true);
        cdHeader.set(nameBytes, 46);
        centralDir.push(cdHeader);

        offset += localHeader.byteLength + size;
    }

    const cdStart = offset;
    for (const cd of centralDir) {
        chunks.push(cd);
        offset += cd.byteLength;
    }

    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, filesList.length, true);
    ev.setUint16(10, filesList.length, true);
    ev.setUint32(12, offset - cdStart, true);
    ev.setUint32(16, cdStart, true);
    chunks.push(eocd);

    return new Blob(chunks, { type: 'application/zip' });
}

// --- Размытие по Гауссу ---
function applyGaussianBlurGray(srcFloat, w, h, sigma) {
    if (sigma <= 0.01) return new Float32Array(srcFloat);
    const radius = Math.max(1, Math.ceil(sigma * 3));
    const kernel = new Float32Array(radius * 2 + 1);
    let sum = 0;
    for (let x = -radius; x <= radius; x++) {
        const val = Math.exp(-(x * x) / (2 * sigma * sigma));
        kernel[x + radius] = val;
        sum += val;
    }
    for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;

    const temp = new Float32Array(w * h);
    const dst = new Float32Array(w * h);

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let acc = 0;
            for (let k = -radius; k <= radius; k++) {
                const px = Math.min(w - 1, Math.max(0, x + k));
                acc += srcFloat[y * w + px] * kernel[k + radius];
            }
            temp[y * w + x] = acc;
        }
    }
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let acc = 0;
            for (let k = -radius; k <= radius; k++) {
                const py = Math.min(h - 1, Math.max(0, y + k));
                acc += temp[py * w + x] * kernel[k + radius];
            }
            dst[y * w + x] = acc;
        }
    }
    return dst;
}

function grayFloatToDataURL(grayArr, w, h) {
    const cvs = document.createElement('canvas');
    cvs.width = w; cvs.height = h;
    const ctx = cvs.getContext('2d');
    const imgData = ctx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
        const v = Math.round(Math.min(255, Math.max(0, grayArr[i])));
        imgData.data[i * 4] = v;
        imgData.data[i * 4 + 1] = v;
        imgData.data[i * 4 + 2] = v;
        imgData.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);
    return cvs.toDataURL('image/png');
}

function computeSimilarity(refArr, candArr, maskArr, metricType) {
    let n = 0, sumR = 0, sumC = 0, sqDiffSum = 0;
    for (let i = 0; i < refArr.length; i++) {
        if (!maskArr[i]) continue;
        const r = refArr[i], c = candArr[i];
        sumR += r; sumC += c;
        const diff = r - c;
        sqDiffSum += diff * diff;
        n++;
    }
    if (n === 0) return 0;

    const meanR = sumR / n, meanC = sumC / n;
    let num = 0, denR = 0, denC = 0;
    for (let i = 0; i < refArr.length; i++) {
        if (!maskArr[i]) continue;
        const dr = refArr[i] - meanR;
        const dc = candArr[i] - meanC;
        num += dr * dc;
        denR += dr * dr;
        denC += dc * dc;
    }

    const pearson = (denR > 1e-6 && denC > 1e-6) ? Math.max(0, num / Math.sqrt(denR * denC)) : 0;
    const rmse = Math.sqrt(sqDiffSum / n);
    const tonalMatch = Math.max(0, 1 - rmse / 255);

    if (metricType === 'pearson') return pearson * 100;
    if (metricType === 'mse') return tonalMatch * 100;
    return (0.65 * pearson + 0.35 * tonalMatch) * 100;
}

// --- Генерация полигонов для одного состояния ---
function buildMonoPolygonsData(prefix, modeLetter, combo, isNegative = false) {
    const mode = RANK_MODE_REV[modeLetter] || modeLetter;
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
    const polys = [];

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
                            if (clippedPoly.length > 2) polys.push(clippedPoly);
                        }
                    });
                });
            });
        }
    }
    return polys;
}

function polysArrayToPath2D(polys) {
    const path = new Path2D();
    for (let i = 0; i < polys.length; i++) {
        const p = polys[i];
        path.moveTo(p[0].x, p[0].y);
        for (let j = 1; j < p.length; j++) path.lineTo(p[j].x, p[j].y);
        path.closePath();
    }
    return path;
}

function polysArrayToSvgGroup(groupId, fillHex, polys, indent = '  ') {
    let s = `${indent}<g id="${groupId}" fill="${fillHex}">\n`;
    for (let i = 0; i < polys.length; i++) {
        s += `${indent}  <polygon points="${polys[i].map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')}" />\n`;
    }
    s += `${indent}</g>\n`;
    return s;
}

// --- Стили и DOM галереи (строго 32 карточки) ---
const galleryStyle = document.createElement('style');
galleryStyle.textContent = `
    #rankGalleryContainer {
        display: none; width: 100%; height: 100%; overflow-y: auto; padding: 16px;
        background: #181818; color: #eee; box-sizing: border-box; font-family: sans-serif;
    }
    .rank-toolbar {
        position: sticky; top: 0; z-index: 10; background: #242424; padding: 12px 16px;
        border-radius: 8px; margin-bottom: 16px; display: flex; flex-wrap: wrap;
        gap: 16px; align-items: center; justify-content: space-between;
        box-shadow: 0 4px 12px rgba(0,0,0,0.5); border: 1px solid #383838;
    }
    .rank-ref-box {
        display: flex; align-items: center; gap: 12px; background: #1a1a1a;
        padding: 6px 12px; border-radius: 6px; border: 1px solid #4CAF50;
    }
    .rank-ref-box img { height: 66px; width: auto; background: #fff; border-radius: 3px; }
    .rank-controls { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .rank-btn {
        background: #383838; color: #fff; border: 1px solid #555; padding: 7px 12px;
        border-radius: 4px; cursor: pointer; font-size: 0.82rem;
    }
    .rank-btn.active { background: #4CAF50; border-color: #4CAF50; font-weight: bold; }
    .rank-grid {
        display: grid; grid-template-columns: repeat(auto-fill, minmax(155px, 1fr));
        gap: 12px;
    }
    .rank-card {
        background: #252525; border: 1px solid rgba(156, 39, 176, 0.65); border-radius: 6px;
        padding: 8px; text-align: center; cursor: pointer; transition: transform 0.12s, border-color 0.12s;
    }
    .rank-card:hover { transform: translateY(-2px); border-color: #4CAF50; }
    .rank-card img {
        width: auto; height: 92px; max-width: 100%; background: #fff;
        border-radius: 3px; margin-bottom: 6px; object-fit: contain;
    }
    .pixelated-img { image-rendering: pixelated; }
    .rank-badge { display: flex; justify-content: space-between; font-size: 0.75rem; margin-bottom: 4px; color: #aaa; }
    .rank-score { color: #4CAF50; font-weight: bold; }
    .rank-title { font-size: 0.84rem; font-weight: bold; color: #fff; margin-bottom: 4px; direction: ltr; }
    .rank-sub { font-size: 0.72rem; color: #bbb; background: #1b1b1b; padding: 3px 4px; border-radius: 3px; }
`;
document.head.appendChild(galleryStyle);

const viewportEl = document.querySelector('.viewport');
const galleryEl = document.createElement('div');
galleryEl.id = 'rankGalleryContainer';
viewportEl.appendChild(galleryEl);

let selected32List = [];
let lastRefThumbs = { blurredUrl: '', crispUrl: '', w: 33, h: 33 };
let galleryViewState = { showBlurred: false };

let cachedBlackPolys = new Map();
let cachedGrayPolys = new Map();
let cachedBlackPaths = new Map();
let cachedGrayPaths = new Map();
let cachedHexClipPath = null;

const rankBlurInput = document.getElementById('rankBlurInput');
const valRankBlur = document.getElementById('val-rankBlur');
if (rankBlurInput && valRankBlur) {
    rankBlurInput.addEventListener('input', (e) => { valRankBlur.value = e.target.value; });
    valRankBlur.addEventListener('change', (e) => { rankBlurInput.value = e.target.value; });
}

function setGalleryVisibility(showGallery) {
    const toggleBtn = document.getElementById('toggleGalleryViewBtn');
    if (toggleBtn) toggleBtn.style.display = 'block';
    mainCanvas.style.display = showGallery ? 'none' : 'block';
    galleryEl.style.display = showGallery ? 'block' : 'none';
}

document.getElementById('toggleGalleryViewBtn')?.addEventListener('click', () => {
    setGalleryVisibility(galleryEl.style.display !== 'block');
});

function ensureItemThumbnails(item) {
    if (item.blurredUrl && item.crispUrl) return;
    const cvsW = mainCanvas.width, cvsH = mainCanvas.height;
    const minSide = Math.min(cvsW, cvsH);
    const scale33 = 33 / minSide;
    const thumbW = lastRefThumbs.w, thumbH = lastRefThumbs.h;
    const crispW = thumbW * 2, crispH = thumbH * 2;
    const scaleCrisp = scale33 * 2;
    const sigma = parseFloat(document.getElementById('val-rankBlur').value) || 0;
    const showOnWhite = document.getElementById('grayOnWhite').checked;
    const showOnBlack = document.getElementById('grayOnBlack').checked;
    const isCropped = document.getElementById('cropToHex')?.checked;

    const crispCvs = document.createElement('canvas');
    crispCvs.width = crispW; crispCvs.height = crispH;
    const ctxCrisp = crispCvs.getContext('2d');

    const crispTempCvs = document.createElement('canvas');
    crispTempCvs.width = crispW; crispTempCvs.height = crispH;
    const ctxCrispTemp = crispTempCvs.getContext('2d');

    const bPath = cachedBlackPaths.get(item.bKey);
    const gPath = cachedGrayPaths.get(item.gKey);

    ctxCrisp.fillStyle = '#ffffff';
    ctxCrisp.fillRect(0, 0, crispW, crispH);
    ctxCrisp.save();
    ctxCrisp.scale(scaleCrisp, scaleCrisp);
    if (isCropped && cachedHexClipPath) ctxCrisp.clip(cachedHexClipPath);
    if (showOnWhite) { ctxCrisp.fillStyle = '#7f7f7f'; ctxCrisp.fill(gPath.orig); }
    ctxCrisp.fillStyle = '#000000';
    ctxCrisp.fill(bPath);
    ctxCrisp.restore();

    if (showOnBlack) {
        ctxCrispTemp.clearRect(0, 0, crispW, crispH);
        ctxCrispTemp.save();
        ctxCrispTemp.scale(scaleCrisp, scaleCrisp);
        if (isCropped && cachedHexClipPath) ctxCrispTemp.clip(cachedHexClipPath);
        ctxCrispTemp.globalCompositeOperation = 'source-over';
        ctxCrispTemp.fillStyle = '#000000';
        ctxCrispTemp.fill(bPath);
        ctxCrispTemp.globalCompositeOperation = 'source-in';
        ctxCrispTemp.fillStyle = '#7f7f7f';
        ctxCrispTemp.fill(gPath.neg);
        ctxCrispTemp.restore();
        ctxCrisp.drawImage(crispTempCvs, 0, 0);
    }

    item.crispUrl = crispCvs.toDataURL('image/png');

    const sensorCvs = document.createElement('canvas');
    sensorCvs.width = thumbW; sensorCvs.height = thumbH;
    const ctxSensor = sensorCvs.getContext('2d');
    ctxSensor.drawImage(crispCvs, 0, 0, thumbW, thumbH);
    const sData = ctxSensor.getImageData(0, 0, thumbW, thumbH).data;
    const rawGray = new Float32Array(thumbW * thumbH);
    for (let k = 0; k < rawGray.length; k++) rawGray[k] = sData[k * 4];
    const blurredGray = applyGaussianBlurGray(rawGray, thumbW, thumbH, sigma);
    item.blurredUrl = grayFloatToDataURL(blurredGray, thumbW, thumbH);
}

function applyComboToUI(prefix, modeLetter, combo) {
    const modeVal = RANK_MODE_REV[modeLetter];
    document.querySelector(`input[name="${prefix}_mode"][value="${modeVal}"]`).checked = true;
    if (BASIC_6_COMBOS.has(combo)) {
        document.querySelector(`input[name="${prefix}_combo"][value="${combo}"]`).checked = true;
    } else {
        document.querySelector(`input[name="${prefix}_combo"][value="custom"]`).checked = true;
        document.getElementById(`${prefix}_combo_select`).value = combo;
    }
}

function renderGalleryDOM() {
    if (selected32List.length === 0) return;
    selected32List.forEach(ensureItemThumbnails);

    const imgClass = galleryViewState.showBlurred ? 'pixelated-img' : '';
    const refImgSrc = galleryViewState.showBlurred ? lastRefThumbs.blurredUrl : lastRefThumbs.crispUrl;

    galleryEl.innerHTML = `
        <div class="rank-toolbar">
            <div class="rank-ref-box">
                <img src="${refImgSrc}" class="${imgClass}">
                <div>
                    <div style="font-weight:bold; font-size:0.85rem; color:#4CAF50;">Эталон (${lastRefThumbs.w}×${lastRefThumbs.h} px)</div>
                    <div style="font-size:0.75rem; color:#aaa;">32 Пути (16 Серых × Топ-2 Чёрных)</div>
                </div>
            </div>
            <div class="rank-controls">
                <button class="rank-btn ${!galleryViewState.showBlurred ? 'active' : ''}" id="btnViewCrisp">
                    ✨ Чёткие миниатюры
                </button>
                <button class="rank-btn ${galleryViewState.showBlurred ? 'active' : ''}" id="btnViewBlur">
                    👁 33px + Гаусс
                </button>
                <button class="rank-btn" id="btnToolbarExportZip" style="background:#9C27B0; border-color:#9C27B0; font-weight:bold;">
                    📦 Скачать 32 SVG (+Фон) в ZIP
                </button>
                <button class="rank-btn" id="btnBackToCanvas" style="background:#2196F3; border-color:#2196F3;">
                    🖼 На холст
                </button>
            </div>
        </div>
        <div class="rank-grid">
            ${selected32List.map((item) => `
                <div class="rank-card" data-bm="${item.bm}" data-bc="${item.bc}" data-gm="${item.gm}" data-gc="${item.gc}">
                    <div class="rank-badge">
                        <span>Узор ${item.patternNum} (Топ-${item.topNum})</span>
                        <span class="rank-score">${item.score.toFixed(1)}%</span>
                    </div>
                    <img src="${galleryViewState.showBlurred ? item.blurredUrl : item.crispUrl}" class="${imgClass}">
                    <div class="rank-title">${item.displayName}</div>
                    <div class="rank-sub">Фон (к ${item.gm}${item.gc}): <b>${item.bg.mode}${item.bg.combo}</b></div>
                </div>
            `).join('')}
        </div>
    `;

    document.getElementById('btnViewBlur').onclick = () => { galleryViewState.showBlurred = true; renderGalleryDOM(); };
    document.getElementById('btnViewCrisp').onclick = () => { galleryViewState.showBlurred = false; renderGalleryDOM(); };
    document.getElementById('btnToolbarExportZip').onclick = () => export32SvgZip();
    document.getElementById('btnBackToCanvas').onclick = () => setGalleryVisibility(false);

    galleryEl.querySelectorAll('.rank-card').forEach(card => {
        card.addEventListener('click', () => {
            applyComboToUI('black', card.dataset.bm, card.dataset.bc);
            applyComboToUI('gray', card.dataset.gm, card.dataset.gc);
            document.getElementById('grayRenderMode').value = 'continuous';
            setGalleryVisibility(false);
            render();
        });
    });
}

// --- Расчёт 16 Серых узоров × все 108 Чёрных и формирование зигзаг-списка из 32 ---
async function compute32SefirotPatterns() {
    if (!sourceImage.src || !mainCanvas.width) return;
    const btn = document.getElementById('runAutoRankBtn');
    if (btn) btn.disabled = true;

    const cols = parseInt(document.getElementById('colsInput').value);
    const rows = parseInt(document.getElementById('rowsInput').value);
    const cvsW = mainCanvas.width, cvsH = mainCanvas.height;
    const sigma = parseFloat(document.getElementById('val-rankBlur').value) || 0;
    const metricType = document.getElementById('rankMetricSelect').value;

    const minSide = Math.min(cvsW, cvsH);
    const scale33 = 33 / minSide;
    const thumbW = Math.max(1, Math.round(cvsW * scale33));
    const thumbH = Math.max(1, Math.round(cvsH * scale33));
    const crispW = thumbW * 2, crispH = thumbH * 2;
    const scaleCrisp = scale33 * 2;

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
    cachedHexClipPath = new Path2D(hexPathD);

    const sensorCvs = document.createElement('canvas');
    sensorCvs.width = thumbW; sensorCvs.height = thumbH;
    const ctxSensor = sensorCvs.getContext('2d', { willReadFrequently: true });

    const sensorTempCvs = document.createElement('canvas');
    sensorTempCvs.width = thumbW; sensorTempCvs.height = thumbH;
    const ctxSensorTemp = sensorTempCvs.getContext('2d');

    const crispCvs = document.createElement('canvas');
    crispCvs.width = crispW; crispCvs.height = crispH;
    const ctxCrisp = crispCvs.getContext('2d');

    ctxSensor.clearRect(0, 0, thumbW, thumbH);
    ctxSensor.save();
    ctxSensor.scale(scale33, scale33);
    ctxSensor.fillStyle = '#000';
    ctxSensor.fill(cachedHexClipPath);
    ctxSensor.restore();
    const maskData = ctxSensor.getImageData(0, 0, thumbW, thumbH).data;
    const activeMask = new Uint8Array(thumbW * thumbH);
    for (let i = 0; i < activeMask.length; i++) activeMask[i] = maskData[i * 4 + 3] > 64 ? 1 : 0;

    ctxCrisp.fillStyle = '#ffffff';
    ctxCrisp.fillRect(0, 0, crispW, crispH);
    ctxCrisp.save();
    ctxCrisp.scale(scaleCrisp, scaleCrisp);
    ctxCrisp.clip(cachedHexClipPath);
    ctxCrisp.drawImage(hiddenCanvas, 0, 0);
    ctxCrisp.restore();

    const refCrispData = ctxCrisp.getImageData(0, 0, crispW, crispH);
    for (let i = 0; i < refCrispData.data.length; i += 4) {
        const lum = Math.round(refCrispData.data[i]*0.299 + refCrispData.data[i+1]*0.587 + refCrispData.data[i+2]*0.114);
        refCrispData.data[i] = refCrispData.data[i+1] = refCrispData.data[i+2] = lum;
    }
    ctxCrisp.putImageData(refCrispData, 0, 0);
    const refCrispUrl = crispCvs.toDataURL('image/png');

    ctxSensor.drawImage(crispCvs, 0, 0, thumbW, thumbH);
    const refSensorPixels = ctxSensor.getImageData(0, 0, thumbW, thumbH).data;
    const refRawGray = new Float32Array(thumbW * thumbH);
    for (let i = 0; i < refRawGray.length; i++) refRawGray[i] = refSensorPixels[i * 4];
    const refBlurredGray = applyGaussianBlurGray(refRawGray, thumbW, thumbH, sigma);
    const refBlurredUrl = grayFloatToDataURL(refBlurredGray, thumbW, thumbH);

    lastRefThumbs = { blurredUrl: refBlurredUrl, crispUrl: refCrispUrl, w: thumbW, h: thumbH };

    // 1. Формируем 16 Серых состояний (Узор 1 .. Узор 16)
    const grayStates = [];
    for (const gm of GRAY_MODES) {
        for (const gc of GRAY_8_COMBOS) {
            grayStates.push({ mLetter: gm, combo: gc, key: `${gm}-${gc}` });
        }
    }

    // 2. Формируем все 108 Чёрных состояний (4 режима A,B,C,D × 27 комбинаций 111..333)
    const blackStates = [];
    for (const bm of ALL_BLACK_MODES) {
        for (const bc of ALL_27_COMBOS) {
            blackStates.push({ mLetter: bm, combo: bc, key: `${bm}-${bc}` });
        }
    }

    cachedBlackPolys.clear();
    cachedGrayPolys.clear();
    cachedBlackPaths.clear();
    cachedGrayPaths.clear();

    // Предрасчёт 16 Серых узоров
    for (let i = 0; i < grayStates.length; i++) {
        const gs = grayStates[i];
        if (btn) btn.textContent = `⏳ Серые узоры: ${i + 1} / 16...`;
        await new Promise(r => setTimeout(r, 0));
        const gOrig = buildMonoPolygonsData('gray', gs.mLetter, gs.combo, false);
        const gNeg = buildMonoPolygonsData('gray', gs.mLetter, gs.combo, true);
        cachedGrayPolys.set(gs.key, { orig: gOrig, neg: gNeg });
        cachedGrayPaths.set(gs.key, { orig: polysArrayToPath2D(gOrig), neg: polysArrayToPath2D(gNeg) });
    }

    // Предрасчёт всех 108 Чёрных вариантов
    for (let i = 0; i < blackStates.length; i++) {
        const bs = blackStates[i];
        if (i % 12 === 0) {
            if (btn) btn.textContent = `⏳ Чёрные варианты: ${i + 1} / 108...`;
            await new Promise(r => setTimeout(r, 0));
        }
        const bPolys = buildMonoPolygonsData('black', bs.mLetter, bs.combo, false);
        cachedBlackPolys.set(bs.key, bPolys);
        cachedBlackPaths.set(bs.key, polysArrayToPath2D(bPolys));
    }

    // 3. Под каждый из 16 Серых узоров перебираем все Чёрные и оставляем Топ-2
    const top2PerGray = []; // массив из 16 элементов: [ [top1, top2], ... ]
    const showOnWhite = document.getElementById('grayOnWhite').checked;
    const showOnBlack = document.getElementById('grayOnBlack').checked;
    const isCropped = document.getElementById('cropToHex')?.checked;

    for (let pIdx = 0; pIdx < grayStates.length; pIdx++) {
        const gState = grayStates[pIdx];
        const gPath = cachedGrayPaths.get(gState.key);
        const candidatesForThisGray = [];

        if (btn) btn.textContent = `🔍 Отбор Топ-2 для Серого узора ${pIdx + 1} / 16...`;
        await new Promise(r => setTimeout(r, 0));

        for (const bState of blackStates) {
            if (bState.key === gState.key) continue;
            const bPath = cachedBlackPaths.get(bState.key);

            ctxSensor.globalCompositeOperation = 'source-over';
            ctxSensor.fillStyle = '#ffffff';
            ctxSensor.fillRect(0, 0, thumbW, thumbH);
            ctxSensor.save();
            ctxSensor.scale(scale33, scale33);
            if (isCropped) ctxSensor.clip(cachedHexClipPath);

            if (showOnWhite) {
                ctxSensor.fillStyle = '#7f7f7f';
                ctxSensor.fill(gPath.orig);
            }
            ctxSensor.fillStyle = '#000000';
            ctxSensor.fill(bPath);
            ctxSensor.restore();

            if (showOnBlack) {
                ctxSensorTemp.clearRect(0, 0, thumbW, thumbH);
                ctxSensorTemp.save();
                ctxSensorTemp.scale(scale33, scale33);
                if (isCropped) ctxSensorTemp.clip(cachedHexClipPath);
                ctxSensorTemp.globalCompositeOperation = 'source-over';
                ctxSensorTemp.fillStyle = '#000000';
                ctxSensorTemp.fill(bPath);
                ctxSensorTemp.globalCompositeOperation = 'source-in';
                ctxSensorTemp.fillStyle = '#7f7f7f';
                ctxSensorTemp.fill(gPath.neg);
                ctxSensorTemp.restore();

                ctxSensor.globalCompositeOperation = 'source-over';
                ctxSensor.drawImage(sensorTempCvs, 0, 0);
            }

            const sData = ctxSensor.getImageData(0, 0, thumbW, thumbH).data;
            const rawGray = new Float32Array(thumbW * thumbH);
            for (let k = 0; k < rawGray.length; k++) rawGray[k] = sData[k * 4];
            const blurredGray = applyGaussianBlurGray(rawGray, thumbW, thumbH, sigma);

            const score = computeSimilarity(refBlurredGray, blurredGray, activeMask, metricType);

            candidatesForThisGray.push({
                patternNum: pIdx + 1,
                bm: bState.mLetter, bc: bState.combo, bKey: bState.key,
                gm: gState.mLetter, gc: gState.combo, gKey: gState.key,
                bg: getComplementaryBgForGray(gState.mLetter, gState.combo, bState.combo),
                score,
                crispUrl: null,
                blurredUrl: null
            });
        }

        candidatesForThisGray.sort((a, b) => b.score - a.score);
        const top1 = { ...candidatesForThisGray[0], topNum: 1 };
        const top2 = { ...candidatesForThisGray[1], topNum: 2 };
        top2PerGray.push([top1, top2]);
    }

    // 4. Выстраиваем 32 узора в точном зигзаг-порядке:
    // Прямой ход (1..16): Топ-1 Узор 1, Топ-2 Узор 2, Топ-1 Узор 3, Топ-2 Узор 4, ..., Топ-2 Узор 16
    // Обратный ход (16..1): Топ-1 Узор 16, Топ-2 Узор 15, ..., Топ-1 Узор 2, Топ-2 Узор 1
    const ordered32 = [];
    for (let i = 0; i < 16; i++) {
        const pickIdx = (i % 2 === 0) ? 0 : 1; // чётный индекс массива (Узор 1, 3, 5...) -> Топ-1 (0), нечётный (Узор 2, 4, 6...) -> Топ-2 (1)
        ordered32.push(top2PerGray[i][pickIdx]);
    }
    for (let i = 15; i >= 0; i--) {
        const pickIdx = (i % 2 === 1) ? 0 : 1; // для Узора 16 (i=15) -> Топ-1 (0), для Узора 15 (i=14) -> Топ-2 (1), ..., для Узора 1 (i=0) -> Топ-2 (1)
        ordered32.push(top2PerGray[i][pickIdx]);
    }

    // Присваиваем номера 1..32, символы Сфирот/Букв и формируем итоговое имя:
    // "1 СООТВЕТСТВУЮЩАЯ_БУКВА_СФЕРОТ A### B### BG###"
    ordered32.forEach((item, idx) => {
        const seqNum = idx + 1;
        const symbol = SEFIROT_SYMBOLS[idx];
        item.seqNum = seqNum;
        item.symbol = symbol;
        item.displayName = `${seqNum} ${symbol} ${item.bm}${item.bc} ${item.gm}${item.gc} ${item.bg.shortTag}`;
        item.fileName = `${item.displayName}.svg`;
    });

    selected32List = ordered32;

    if (btn) {
        btn.disabled = false;
        btn.textContent = '🔍 Пересчитать 32 узора';
    }
}

document.getElementById('runAutoRankBtn')?.addEventListener('click', async () => {
    await compute32SefirotPatterns();
    setGalleryVisibility(true);
    renderGalleryDOM();
});

// --- ЭКСПОРТ 32 SVG С КОМПЛИМЕНТАРНЫМ СЕРОМУ СЛОЮ ФОНОМ В ZIP ---
async function export32SvgZip() {
    const expBtn = document.getElementById('exportTopSvgZipBtn');
    const toolbarBtn = document.getElementById('btnToolbarExportZip');

    if (selected32List.length === 0) {
        await compute32SefirotPatterns();
    }

    if (expBtn) expBtn.disabled = true;
    if (toolbarBtn) toolbarBtn.disabled = true;

    const cols = parseInt(document.getElementById('colsInput').value);
    const rows = parseInt(document.getElementById('rowsInput').value);
    const cvsW = mainCanvas.width, cvsH = mainCanvas.height;
    const hexW = cvsW / (cols * 2 + 1), hexH = cvsH / (rows * 3 + 1);
    const isCropped = document.getElementById('cropToHex')?.checked;
    const grayColor = '#7f7f7f';

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

    const zipFiles = [];

    for (let i = 0; i < selected32List.length; i++) {
        const item = selected32List[i];
        const statusText = `📦 Сборка SVG: ${i + 1} / 32...`;
        if (expBtn) expBtn.textContent = statusText;
        if (toolbarBtn) toolbarBtn.textContent = statusText;
        await new Promise(r => setTimeout(r, 0));

        const blackPolys = cachedBlackPolys.get(item.bKey);
        const grayPolys = cachedGrayPolys.get(item.gKey);
        const bgPolys = cachedBlackPolys.get(item.bg.key);

        let svgStr = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${cvsW} ${cvsH}">\n`;

        // 1. Слой Фона (чисто чёрный, комплиментарный Серому слою)
        svgStr += polysArrayToSvgGroup(`Background_${item.bg.mode}${item.bg.combo}`, '#000000', bgPolys, '  ');

        // 2. Группа Объекта
        svgStr += `  <g id="Object_${item.bm}${item.bc}_${item.gm}${item.gc}_CNT">\n`;
        if (isCropped) {
            svgStr += polysArrayToSvgGroup('Layer_Crop_Hexagons', '#FFFFFF', hexPolys, '    ');
        }
        svgStr += polysArrayToSvgGroup('Layer_Gray_Original', grayColor, grayPolys.orig, '    ');
        svgStr += polysArrayToSvgGroup('Layer_Black', '#000000', blackPolys, '    ');
        svgStr += polysArrayToSvgGroup('Layer_Gray_Negative', grayColor, grayPolys.neg, '    ');
        svgStr += `  </g>\n`;

        svgStr += `</svg>`;

        zipFiles.push({ name: item.fileName, content: svgStr });
    }

    const zipBlob = buildZipBlob(zipFiles);
    const url = URL.createObjectURL(zipBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `xylo_${cols}x${rows}_32_Sefirot.zip`;
    link.click();
    URL.revokeObjectURL(url);

    if (expBtn) {
        expBtn.disabled = false;
        expBtn.textContent = '📦 Скачать 32 SVG (+Фон) в ZIP';
    }
    if (toolbarBtn) {
        toolbarBtn.disabled = false;
        toolbarBtn.textContent = '📦 Скачать 32 SVG (+Фон) в ZIP';
    }
}

document.getElementById('exportTopSvgZipBtn')?.addEventListener('click', export32SvgZip);