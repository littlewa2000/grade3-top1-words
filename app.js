const ZHUYIN_EL = document.getElementById('zhuyin');
const CANVAS = document.getElementById('pad');
const CTX = CANVAS.getContext('2d', { willReadFrequently: true });

const btnNext = document.getElementById('btnNext');
const btnClear = document.getElementById('btnClear');
const penSize = document.getElementById('penSize');
const penSizeVal = document.getElementById('penSizeVal');
const penColor = document.getElementById('penColor');

let drawing = false;
let last = null;

const WORDS = window.WORDS || [];
let currentWord = null;

function nextWord() {
  if (!WORDS.length) {
    alert("data.js 沒有資料！");
    return;
  }
  const idx = Math.floor(Math.random() * WORDS.length);
  currentWord = WORDS[idx];
  ZHUYIN_EL.textContent = currentWord.zhuyin;
  clearCanvas();
}

function clearCanvas() {
  CTX.fillStyle = "#ffffff";
  CTX.fillRect(0, 0, CANVAS.width, CANVAS.height);
}

function getPos(e) {
  const rect = CANVAS.getBoundingClientRect();
  const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
  const y = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
  return { x: x * (CANVAS.width / rect.width), y: y * (CANVAS.height / rect.height) };
}

function setLineStyle() {
  CTX.lineCap = 'round';
  CTX.lineJoin = 'round';
  CTX.strokeStyle = penColor.value;
  CTX.lineWidth = Number(penSize.value || 10);
}

CANVAS.addEventListener("pointerdown", e => {
  drawing = true;
  last = getPos(e);
  setLineStyle();
});

CANVAS.addEventListener("pointermove", e => {
  if (!drawing) return;
  const p = getPos(e);
  CTX.beginPath();
  CTX.moveTo(last.x, last.y);
  CTX.lineTo(p.x, p.y);
  CTX.stroke();
  last = p;
});

window.addEventListener("pointerup", () => { drawing = false; });

btnClear.addEventListener("click", clearCanvas);
btnNext.addEventListener("click", nextWord);

penSize.addEventListener("input", () => {
  penSizeVal.textContent = penSize.value;
});

nextWord();
