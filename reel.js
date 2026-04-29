// ===================== DATA =====================
const films = [
  {
    key:"hail-mary", no:"01",
    title:"project hail mary",
    type:"Hard sci-fi · 2026",
    byline:"Andy Weir · adapted by Drew Goddard",
    img:"posters/hail-mary.jpg",
    quote:"\"Question?\" — \"Answer.\"",
    note:"A solo astronaut wakes up alone, light-years from home, with a job to save the sun. What he finds instead is a friend.",
    meta:{Director:"Phil Lord & Christopher Miller", Year:"2026", Watched:"April 2026", Tags:"Friendship · Solitude"}
  },
  {
    key:"mario-galaxy", no:"02",
    title:"mario galaxy",
    type:"Animation · 2026",
    byline:"A film by Illumination · Nintendo",
    img:"posters/mario-galaxy.jpg",
    quote:"\"The cosmos remembers.\"",
    note:"Mario in space. Rosalina. Lumas. The Comet Observatory. The poster maps the cast as a small constellation.",
    meta:{Director:"Aaron Horvath & Michael Jelenic", Year:"2026", Watched:"April 2026", Tags:"Adventure · Family"}
  }
];

// ===================== WEBGL DISPLACEMENT (Justine-style) =====================
// Each poster gets a small WebGL canvas overlay running a flowing displacement
// + grain shader. Pointer position drives a hover ripple. Idle = slow breathing wave.
const VS = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main(){
  v_uv = a_pos * 0.5 + 0.5;
  v_uv.y = 1.0 - v_uv.y;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FS = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_time;
uniform vec2 u_mouse;     // 0..1, or (-1,-1) when off
uniform float u_hover;    // 0..1
uniform float u_active;   // 0..1
uniform vec2 u_imgSize;   // natural width/height
uniform vec2 u_canvasSize;

// 2D simplex-ish noise (cheap)
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453123); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1.0,0.0));
  float c = hash(i + vec2(0.0,1.0));
  float d = hash(i + vec2(1.0,1.0));
  vec2 u = f*f*(3.0-2.0*f);
  return mix(a,b,u.x) + (c-a)*u.y*(1.0-u.x) + (d-b)*u.x*u.y;
}

void main(){
  // Object-fit:contain math so posters keep true 2:3
  float canvasAspect = u_canvasSize.x / u_canvasSize.y;
  float imgAspect = u_imgSize.x / u_imgSize.y;
  vec2 uv = v_uv;
  vec2 scale = vec2(1.0);
  vec2 offset = vec2(0.0);
  if(canvasAspect > imgAspect){
    scale.x = canvasAspect / imgAspect;
    offset.x = (1.0 - 1.0/scale.x) * 0.5;
    uv.x = (v_uv.x - offset.x) * scale.x;
  } else {
    scale.y = imgAspect / canvasAspect;
    offset.y = (1.0 - 1.0/scale.y) * 0.5;
    uv.y = (v_uv.y - offset.y) * scale.y;
  }

  // Idle breathing displacement
  float t = u_time * 0.18;
  float n1 = vnoise(uv * 3.5 + vec2(t, t*0.7));
  float n2 = vnoise(uv * 6.0 - vec2(t*0.5, t*1.1));
  vec2 disp = vec2(n1 - 0.5, n2 - 0.5) * 0.012 * (0.6 + 0.4 * u_active);

  // Hover ripple
  if(u_mouse.x >= 0.0){
    vec2 toMouse = uv - u_mouse;
    float d = length(toMouse);
    float ripple = exp(-d * 6.0) * u_hover;
    disp += normalize(toMouse + 0.0001) * ripple * 0.04;
    disp += vec2(sin(d*40.0 - u_time*3.5), cos(d*40.0 - u_time*3.5)) * ripple * 0.008;
  }

  vec2 sampleUV = uv + disp;
  // Out-of-bounds = paper color
  vec3 paper = vec3(0.92, 0.879, 0.831);
  vec4 col;
  if(sampleUV.x < 0.0 || sampleUV.x > 1.0 || sampleUV.y < 0.0 || sampleUV.y > 1.0){
    col = vec4(paper, 1.0);
  } else {
    col = texture2D(u_tex, sampleUV);
  }

  // Soft grain on top
  float grain = (hash(gl_FragCoord.xy + u_time*60.0) - 0.5) * 0.045;
  col.rgb += grain;

  // Slight chromatic edge tint near displacement
  float edge = length(disp) * 8.0;
  col.r += edge * 0.04;
  col.b -= edge * 0.03;

  gl_FragColor = col;
}`;

class PosterGL {
  constructor(canvas, imgUrl){
    this.canvas = canvas;
    this.imgUrl = imgUrl;
    this.gl = canvas.getContext("webgl", {premultipliedAlpha:false, antialias:true});
    if(!this.gl) return;
    this.mouse = {x:-1, y:-1};
    this.hover = 0; this.targetHover = 0;
    this.active = 0; this.targetActive = 0;
    this.imgSize = {w:1,h:1};
    this.startTime = performance.now();
    this.ready = false;
    this._init();
    this._loadTex();
  }
  _shader(type, src){
    const gl = this.gl;
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if(!gl.getShaderParameter(sh, gl.COMPILE_STATUS)){
      console.error(gl.getShaderInfoLog(sh)); return null;
    }
    return sh;
  }
  _init(){
    const gl = this.gl;
    const prog = gl.createProgram();
    gl.attachShader(prog, this._shader(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, this._shader(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if(!gl.getProgramParameter(prog, gl.LINK_STATUS)){ console.error(gl.getProgramInfoLog(prog)); return; }
    gl.useProgram(prog);
    this.prog = prog;

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "a_pos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    this.u = {
      tex:        gl.getUniformLocation(prog, "u_tex"),
      time:       gl.getUniformLocation(prog, "u_time"),
      mouse:      gl.getUniformLocation(prog, "u_mouse"),
      hover:      gl.getUniformLocation(prog, "u_hover"),
      active:     gl.getUniformLocation(prog, "u_active"),
      imgSize:    gl.getUniformLocation(prog, "u_imgSize"),
      canvasSize: gl.getUniformLocation(prog, "u_canvasSize"),
    };
  }
  _loadTex(){
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    // 1x1 placeholder
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([235,224,210,255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    this.tex = tex;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      this.imgSize = {w:img.naturalWidth, h:img.naturalHeight};
      this.ready = true;
    };
    img.src = this.imgUrl;
  }
  resize(){
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if(this.canvas.width !== w*dpr || this.canvas.height !== h*dpr){
      this.canvas.width = w*dpr; this.canvas.height = h*dpr;
      this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    }
  }
  setMouse(nx, ny){ this.mouse.x = nx; this.mouse.y = ny; }
  setHover(on){ this.targetHover = on ? 1 : 0; }
  setActive(on){ this.targetActive = on ? 1 : 0; }
  render(){
    if(!this.gl || !this.prog) return;
    this.resize();
    const gl = this.gl;
    // ease toward targets
    this.hover += (this.targetHover - this.hover) * 0.08;
    this.active += (this.targetActive - this.active) * 0.06;

    const t = (performance.now() - this.startTime) / 1000;
    gl.useProgram(this.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(this.u.tex, 0);
    gl.uniform1f(this.u.time, t);
    gl.uniform2f(this.u.mouse, this.mouse.x, this.mouse.y);
    gl.uniform1f(this.u.hover, this.hover);
    gl.uniform1f(this.u.active, this.active);
    gl.uniform2f(this.u.imgSize, this.imgSize.w, this.imgSize.h);
    gl.uniform2f(this.u.canvasSize, this.canvas.width, this.canvas.height);
    gl.clearColor(0.92, 0.879, 0.831, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
}

// ===================== BUILD =====================
const strip = document.getElementById("strip");
const renderers = [];

films.forEach((f,i) => {
  const frame = document.createElement("div");
  frame.className = "frame" + (i===0 ? " active":"");
  frame.dataset.idx = i;
  frame.innerHTML = `<div class="poster">
    <img class="hidden" src="${f.img}" alt="${f.title} poster">
    <canvas></canvas>
  </div>`;
  const canvas = frame.querySelector("canvas");
  const poster = frame.querySelector(".poster");
  const gl = new PosterGL(canvas, f.img);
  renderers.push({gl, frame, poster});

  poster.addEventListener("click", () => openDetail(i));
  poster.addEventListener("mouseenter", () => gl.setHover(true));
  poster.addEventListener("mouseleave", () => { gl.setHover(false); gl.setMouse(-1,-1); });
  poster.addEventListener("mousemove", e => {
    const r = poster.getBoundingClientRect();
    gl.setMouse((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
  });
  poster.addEventListener("touchmove", e => {
    if(!e.touches[0]) return;
    const r = poster.getBoundingClientRect();
    gl.setMouse((e.touches[0].clientX - r.left)/r.width, (e.touches[0].clientY - r.top)/r.height);
    gl.setHover(true);
  }, {passive:true});
  poster.addEventListener("touchend", () => { gl.setHover(false); gl.setMouse(-1,-1); });

  strip.appendChild(frame);
});

const end = document.createElement("div");
end.className = "endcard";
end.dataset.idx = films.length;
end.innerHTML = `
  <h2>films, reimagined as <em>posters</em>.</h2>
  <p>A slow personal record of the films I love — translated into the visual language I'd want to hang on my wall. One film. One poster. One quiet idea.</p>
  <p>No spoilers. No star ratings. Just attention.</p>
  <div class="sig">— Saber, Shanghai</div>
`;
strip.appendChild(end);

document.getElementById("cntTot").textContent = String(films.length).padStart(2,"0");

// Render loop
function loop(){
  renderers.forEach(r => r.gl.render());
  requestAnimationFrame(loop);
}
loop();

// ===================== ACTIVE TRACKING =====================
const stage = document.getElementById("stage");
const nameplate = document.getElementById("nameplate");
const npNum = document.getElementById("npNum");
const npNameText = document.getElementById("npNameText");
const npType = document.getElementById("npType");
const cntCur = document.getElementById("cntCur");
let currentIdx = -1;

function updateActive(){
  const center = window.innerWidth / 2;
  const items = strip.querySelectorAll(".frame, .endcard");
  let bestIdx = 0, bestDist = Infinity;
  items.forEach((f,i) => {
    const r = f.getBoundingClientRect();
    const d = Math.abs((r.left + r.right)/2 - center);
    if(d < bestDist){ bestDist = d; bestIdx = i; }
  });
  if(bestIdx === currentIdx) return;
  currentIdx = bestIdx;
  items.forEach((f,i) => f.classList.toggle("active", i===bestIdx));
  renderers.forEach((r,i) => r.gl.setActive(i === bestIdx));

  if(bestIdx < films.length){
    const f = films[bestIdx];
    nameplate.classList.remove("show");
    setTimeout(() => {
      npNum.textContent = "Entry No. " + f.no;
      npNameText.textContent = f.title;
      npType.textContent = f.type + "  ·  " + f.byline;
      nameplate.classList.add("show");
    }, 100);
    cntCur.textContent = String(bestIdx+1).padStart(2,"0");
  } else {
    nameplate.classList.remove("show");
    cntCur.textContent = "—";
  }
}
stage.addEventListener("scroll", () => requestAnimationFrame(updateActive), {passive:true});
window.addEventListener("resize", updateActive);
setTimeout(updateActive, 200);

// ===================== INTERACTIONS =====================
stage.addEventListener("wheel", e => {
  if(Math.abs(e.deltaY) > Math.abs(e.deltaX)){
    e.preventDefault();
    stage.scrollLeft += e.deltaY * 1.3;
  }
}, {passive:false});

let isDown=false, startX=0, startScroll=0;
strip.addEventListener("mousedown", e => { isDown=true; startX=e.pageX; startScroll=stage.scrollLeft; strip.classList.add("dragging"); });
window.addEventListener("mouseup", () => { isDown=false; strip.classList.remove("dragging"); });
window.addEventListener("mousemove", e => { if(!isDown) return; stage.scrollLeft = startScroll - (e.pageX - startX); });

document.addEventListener("keydown", e => {
  if(document.getElementById("detail").classList.contains("open")){
    if(e.key === "Escape") closeDetail();
    return;
  }
  const items = strip.querySelectorAll(".frame, .endcard");
  if(e.key === "ArrowRight" && currentIdx < items.length-1){
    items[currentIdx+1].scrollIntoView({behavior:"smooth", inline:"center", block:"nearest"});
  } else if(e.key === "ArrowLeft" && currentIdx > 0){
    items[currentIdx-1].scrollIntoView({behavior:"smooth", inline:"center", block:"nearest"});
  } else if((e.key === "Enter" || e.key === " ") && currentIdx < films.length){
    e.preventDefault(); openDetail(currentIdx);
  }
});

// ===================== DETAIL =====================
const detail = document.getElementById("detail");
function openDetail(i){
  const f = films[i]; if(!f) return;
  document.getElementById("dImg").src = f.img;
  document.getElementById("dImg").alt = f.title + " poster";
  document.getElementById("dKicker").textContent = "Entry No. " + f.no;
  document.getElementById("dTitle").textContent = f.title;
  document.getElementById("dByline").textContent = f.byline;
  document.getElementById("dQuote").textContent = f.quote;
  document.getElementById("dNote").textContent = f.note;
  document.getElementById("dMeta").innerHTML = Object.entries(f.meta).map(([k,v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
  detail.classList.add("open");
}
function closeDetail(){ detail.classList.remove("open"); }
document.getElementById("closeDetail").addEventListener("click", closeDetail);
detail.addEventListener("click", e => { if(e.target === detail) closeDetail(); });

document.getElementById("aboutBtn").addEventListener("click", e => {
  e.preventDefault();
  document.querySelector(".endcard").scrollIntoView({behavior:"smooth", inline:"center"});
});
