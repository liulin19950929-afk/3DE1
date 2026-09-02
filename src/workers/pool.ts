/**
 * 多线程 CPU 计算池
 * ------------------------------------------------------------------
 * Worker 源码以字符串内联 + Blob URL 创建，因此在单文件构建中依然可用。
 * 线程数默认 = navigator.hardwareConcurrency（可在设置中调整）。
 * 支持任务：壁厚分析、拔模分析、质量特性、隐藏线消除(HLR)、三角化重采样、基准测试。
 */

const WORKER_SRC = String.raw`
// ---------- 均匀网格加速结构 ----------
function buildGrid(pos, idx) {
  const triCount = idx.length / 3;
  let minx=Infinity,miny=Infinity,minz=Infinity,maxx=-Infinity,maxy=-Infinity,maxz=-Infinity;
  for (let i=0;i<pos.length;i+=3){
    const x=pos[i],y=pos[i+1],z=pos[i+2];
    if(x<minx)minx=x; if(y<miny)miny=y; if(z<minz)minz=z;
    if(x>maxx)maxx=x; if(y>maxy)maxy=y; if(z>maxz)maxz=z;
  }
  const pad=Math.max(1e-6,(maxx-minx+maxy-miny+maxz-minz)*1e-4);
  minx-=pad;miny-=pad;minz-=pad;maxx+=pad;maxy+=pad;maxz+=pad;
  const n = Math.max(1, Math.min(56, Math.round(Math.cbrt(triCount/1.5))||1));
  const sx=(maxx-minx)/n, sy=(maxy-miny)/n, sz=(maxz-minz)/n;
  const cells = new Array(n*n*n);
  for (let t=0;t<triCount;t++){
    const a=idx[t*3]*3,b=idx[t*3+1]*3,c=idx[t*3+2]*3;
    const lx=Math.min(pos[a],pos[b],pos[c]), hx=Math.max(pos[a],pos[b],pos[c]);
    const ly=Math.min(pos[a+1],pos[b+1],pos[c+1]), hy=Math.max(pos[a+1],pos[b+1],pos[c+1]);
    const lz=Math.min(pos[a+2],pos[b+2],pos[c+2]), hz=Math.max(pos[a+2],pos[b+2],pos[c+2]);
    const i0=Math.max(0,Math.floor((lx-minx)/sx)), i1=Math.min(n-1,Math.floor((hx-minx)/sx));
    const j0=Math.max(0,Math.floor((ly-miny)/sy)), j1=Math.min(n-1,Math.floor((hy-miny)/sy));
    const k0=Math.max(0,Math.floor((lz-minz)/sz)), k1=Math.min(n-1,Math.floor((hz-minz)/sz));
    for(let i=i0;i<=i1;i++)for(let j=j0;j<=j1;j++)for(let k=k0;k<=k1;k++){
      const ci=(i*n+j)*n+k; (cells[ci]||(cells[ci]=[])).push(t);
    }
  }
  return {n,minx,miny,minz,sx,sy,sz,cells,maxx,maxy,maxz};
}

function rayTri(ox,oy,oz,dx,dy,dz,ax,ay,az,bx,by,bz,cx,cy,cz){
  const e1x=bx-ax,e1y=by-ay,e1z=bz-az;
  const e2x=cx-ax,e2y=cy-ay,e2z=cz-az;
  const px=dy*e2z-dz*e2y, py=dz*e2x-dx*e2z, pz=dx*e2y-dy*e2x;
  const det=e1x*px+e1y*py+e1z*pz;
  if (Math.abs(det)<1e-12) return -1;
  const inv=1/det;
  const tx=ox-ax,ty=oy-ay,tz=oz-az;
  const u=(tx*px+ty*py+tz*pz)*inv;
  if(u<-1e-7||u>1+1e-7) return -1;
  const qx=ty*e1z-tz*e1y, qy=tz*e1x-tx*e1z, qz=tx*e1y-ty*e1x;
  const v=(dx*qx+dy*qy+dz*qz)*inv;
  if(v<-1e-7||u+v>1+1e-7) return -1;
  return (e2x*qx+e2y*qy+e2z*qz)*inv;
}

// 沿射线步进收集网格单元并求最近命中
function raycast(g,pos,idx,ox,oy,oz,dx,dy,dz,maxT,anyHit){
  const step=Math.min(g.sx,g.sy,g.sz)*0.5||1;
  let best=Infinity;
  const seen=new Set();
  const n=g.n;
  const diag=Math.hypot(g.maxx-g.minx,g.maxy-g.miny,g.maxz-g.minz);
  const lim=Math.min(maxT===undefined?diag*2:maxT,diag*2);
  for(let t=0;t<=lim;t+=step){
    const x=ox+dx*t,y=oy+dy*t,z=oz+dz*t;
    const i=Math.floor((x-g.minx)/g.sx), j=Math.floor((y-g.miny)/g.sy), k=Math.floor((z-g.minz)/g.sz);
    if(i<0||j<0||k<0||i>=n||j>=n||k>=n) { if(t>0&&best<Infinity) break; continue; }
    const ci=(i*n+j)*n+k;
    if(seen.has(ci)) continue; seen.add(ci);
    const list=g.cells[ci]; if(!list) continue;
    for(let li=0;li<list.length;li++){
      const tri=list[li];
      const a=idx[tri*3]*3,b=idx[tri*3+1]*3,c=idx[tri*3+2]*3;
      const hit=rayTri(ox,oy,oz,dx,dy,dz,pos[a],pos[a+1],pos[a+2],pos[b],pos[b+1],pos[b+2],pos[c],pos[c+1],pos[c+2]);
      if(hit>1e-6&&hit<best){ best=hit; if(anyHit) return best; }
    }
    if(best<Infinity && best<t+step*1.5) break;
  }
  return best;
}

self.onmessage = function(ev){
  const m = ev.data;
  const id = m.id;
  try {
    if (m.op === 'thickness') {
      const pos=m.pos, idx=m.idx, g=buildGrid(pos,idx);
      const out=new Float32Array(m.end-m.start);
      for(let t=m.start;t<m.end;t++){
        const a=idx[t*3]*3,b=idx[t*3+1]*3,c=idx[t*3+2]*3;
        const cx=(pos[a]+pos[b]+pos[c])/3, cy=(pos[a+1]+pos[b+1]+pos[c+1])/3, cz=(pos[a+2]+pos[b+2]+pos[c+2])/3;
        const ux=pos[b]-pos[a],uy=pos[b+1]-pos[a+1],uz=pos[b+2]-pos[a+2];
        const vx=pos[c]-pos[a],vy=pos[c+1]-pos[a+1],vz=pos[c+2]-pos[a+2];
        let nx=uy*vz-uz*vy, ny=uz*vx-ux*vz, nz=ux*vy-uy*vx;
        const L=Math.hypot(nx,ny,nz)||1; nx/=L;ny/=L;nz/=L;
        const eps=(g.sx+g.sy+g.sz)*0.002+1e-5;
        let d=raycast(g,pos,idx,cx-nx*eps,cy-ny*eps,cz-nz*eps,-nx,-ny,-nz,undefined,false);
        if(!isFinite(d)) d=-1;
        // 多方向采样（精细/超精）取最小值
        if(m.rays>1&&d>0){
          const spread=m.rays===3?0.35:0.18;
          const tx=Math.abs(nx)<0.9?1:0, ty=Math.abs(nx)<0.9?0:1;
          let px=ty*nz-0*ny, py=0*nx-tx*nz, pz=tx*ny-ty*nx;
          const pl=Math.hypot(px,py,pz)||1; px/=pl;py/=pl;pz/=pl;
          const qx=ny*pz-nz*py, qy=nz*px-nx*pz, qz=nx*py-ny*px;
          const count=m.rays===3?8:4;
          for(let s=0;s<count;s++){
            const ang=(s/count)*Math.PI*2;
            let rx=-nx+ (px*Math.cos(ang)+qx*Math.sin(ang))*spread;
            let ry=-ny+ (py*Math.cos(ang)+qy*Math.sin(ang))*spread;
            let rz=-nz+ (pz*Math.cos(ang)+qz*Math.sin(ang))*spread;
            const rl=Math.hypot(rx,ry,rz)||1; rx/=rl;ry/=rl;rz/=rl;
            const dd=raycast(g,pos,idx,cx-nx*eps,cy-ny*eps,cz-nz*eps,rx,ry,rz,undefined,false);
            if(isFinite(dd)&&dd<d) d=dd;
          }
        }
        out[t-m.start]=d;
        if(((t-m.start)&1023)===0) self.postMessage({id,progress:(t-m.start)/(m.end-m.start)});
      }
      self.postMessage({id,done:true,result:out},[out.buffer]);
    } else if (m.op === 'draft') {
      const pos=m.pos, idx=m.idx, dir=m.dir;
      const out=new Float32Array(m.end-m.start);
      for(let t=m.start;t<m.end;t++){
        const a=idx[t*3]*3,b=idx[t*3+1]*3,c=idx[t*3+2]*3;
        const ux=pos[b]-pos[a],uy=pos[b+1]-pos[a+1],uz=pos[b+2]-pos[a+2];
        const vx=pos[c]-pos[a],vy=pos[c+1]-pos[a+1],vz=pos[c+2]-pos[a+2];
        let nx=uy*vz-uz*vy, ny=uz*vx-ux*vz, nz=ux*vy-uy*vx;
        const L=Math.hypot(nx,ny,nz)||1; nx/=L;ny/=L;nz/=L;
        const dot=Math.max(-1,Math.min(1,nx*dir[0]+ny*dir[1]+nz*dir[2]));
        out[t-m.start]=90-Math.acos(dot)*180/Math.PI; // 与脱模方向的拔模角
      }
      self.postMessage({id,done:true,result:out},[out.buffer]);
    } else if (m.op === 'mass') {
      const pos=m.pos, idx=m.idx;
      let vol=0, area=0, cx=0, cy=0, cz=0;
      for(let t=m.start;t<m.end;t++){
        const a=idx[t*3]*3,b=idx[t*3+1]*3,c=idx[t*3+2]*3;
        const ax=pos[a],ay=pos[a+1],az=pos[a+2];
        const bx=pos[b],by=pos[b+1],bz=pos[b+2];
        const cx2=pos[c],cy2=pos[c+1],cz2=pos[c+2];
        const v=(ax*(by*cz2-bz*cy2)-ay*(bx*cz2-bz*cx2)+az*(bx*cy2-by*cx2))/6;
        vol+=v;
        cx+=(ax+bx+cx2)/4*v; cy+=(ay+by+cy2)/4*v; cz+=(az+bz+cz2)/4*v;
        const ux=bx-ax,uy=by-ay,uz=bz-az, vx=cx2-ax,vy=cy2-ay,vz=cz2-az;
        area+=0.5*Math.hypot(uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx);
      }
      self.postMessage({id,done:true,result:{vol,area,cx,cy,cz}});
    } else if (m.op === 'hlr') {
      // 隐藏线消除：对每条线段采样并向相机方向投射
      const pos=m.pos, idx=m.idx, segs=m.segs, dir=m.dir, samples=m.samples||9;
      const g=buildGrid(pos,idx);
      const flags=new Uint8Array((m.end-m.start)*samples);
      for(let s=m.start;s<m.end;s++){
        const o=s*6;
        for(let k=0;k<samples;k++){
          const u=(k+0.5)/samples;
          const x=segs[o]+(segs[o+3]-segs[o])*u;
          const y=segs[o+1]+(segs[o+4]-segs[o+1])*u;
          const z=segs[o+2]+(segs[o+5]-segs[o+2])*u;
          const eps=(g.sx+g.sy+g.sz)*0.01+1e-4;
          const d=raycast(g,pos,idx,x+dir[0]*eps,y+dir[1]*eps,z+dir[2]*eps,dir[0],dir[1],dir[2],undefined,true);
          flags[(s-m.start)*samples+k]= isFinite(d)?1:0;
        }
      }
      self.postMessage({id,done:true,result:flags},[flags.buffer]);
    } else if (m.op === 'stepFaces') {
      // 并行三角化 STEP 面环：入参是打包好的多边形（扁平数组 + 每环点数）
      const polys = m.polys, counts = m.counts;
      const out = [];
      let off = 0;
      for (let ci = 0; ci < counts.length; ci++) {
        const n = counts[ci];
        if (ci < m.start || ci >= m.end) { off += n * 3; continue; }
        const pts = [];
        for (let i = 0; i < n; i++) pts.push([polys[off + i*3], polys[off + i*3 + 1], polys[off + i*3 + 2]]);
        off += n * 3;
        if (n < 3) continue;
        if (n === 3) { for (const p of pts) out.push(p[0], p[1], p[2]); continue; }
        // 平面法线（Newell）
        let nx=0, ny=0, nz=0;
        for (let i = 0; i < n; i++) {
          const a = pts[i], b = pts[(i+1)%n];
          nx += (a[1]-b[1])*(a[2]+b[2]);
          ny += (a[2]-b[2])*(a[0]+b[0]);
          nz += (a[0]-b[0])*(a[1]+b[1]);
        }
        const nl = Math.hypot(nx,ny,nz);
        if (nl < 1e-12) continue;
        nx/=nl; ny/=nl; nz/=nl;
        let ux=1, uy=0, uz=0;
        if (Math.abs(nx) > 0.9) { ux=0; uy=1; uz=0; }
        let xax=[ny*uz-nz*uy, nz*ux-nx*uz, nx*uy-ny*ux];
        const xl = Math.hypot(xax[0],xax[1],xax[2])||1;
        xax = [xax[0]/xl, xax[1]/xl, xax[2]/xl];
        const yax = [ny*xax[2]-nz*xax[1], nz*xax[0]-nx*xax[2], nx*xax[1]-ny*xax[0]];
        const o = pts[0];
        const flat = pts.map(p => {
          const dx=p[0]-o[0], dy=p[1]-o[1], dz=p[2]-o[2];
          return [dx*xax[0]+dy*xax[1]+dz*xax[2], dx*yax[0]+dy*yax[1]+dz*yax[2]];
        });
        // 耳切法三角化
        let area = 0;
        for (let i = 0; i < n; i++) { const a=flat[i], b=flat[(i+1)%n]; area += a[0]*b[1]-b[0]*a[1]; }
        const idx = [];
        for (let i = 0; i < n; i++) idx.push(area > 0 ? i : n-1-i);
        let guard = 0;
        while (idx.length > 3 && guard++ < n*n) {
          let clipped = false;
          for (let i = 0; i < idx.length; i++) {
            const i0 = idx[(i+idx.length-1)%idx.length], i1 = idx[i], i2 = idx[(i+1)%idx.length];
            const a=flat[i0], b=flat[i1], c=flat[i2];
            const cross = (b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0]);
            if (cross <= 0) continue;
            let ok = true;
            for (const j of idx) {
              if (j===i0||j===i1||j===i2) continue;
              const p = flat[j];
              const d1 = (b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
              const d2 = (c[0]-b[0])*(p[1]-b[1])-(c[1]-b[1])*(p[0]-b[0]);
              const d3 = (a[0]-c[0])*(p[1]-c[1])-(a[1]-c[1])*(p[0]-c[0]);
              if (d1>=0 && d2>=0 && d3>=0) { ok=false; break; }
            }
            if (!ok) continue;
            for (const k of [i0,i1,i2]) out.push(pts[k][0], pts[k][1], pts[k][2]);
            idx.splice(i,1);
            clipped = true;
            break;
          }
          if (!clipped) break;
        }
        if (idx.length === 3) for (const k of idx) out.push(pts[k][0], pts[k][1], pts[k][2]);
        if (((ci - m.start) & 255) === 0) self.postMessage({id, progress:(ci-m.start)/Math.max(1,m.end-m.start)});
      }
      const arr = new Float32Array(out);
      self.postMessage({id, done:true, result:arr}, [arr.buffer]);
    } else if (m.op === 'stepScan') {
      // 并行扫描 STEP 文本块，抽取实体行
      const text = m.text;
      const re = /#(\d+)\s*=\s*([A-Z_0-9]+)\s*\(([\s\S]*?)\)\s*;/g;
      const ids = [], types = [], args = [];
      let mm;
      while ((mm = re.exec(text))) { ids.push(+mm[1]); types.push(mm[2]); args.push(mm[3]); }
      self.postMessage({id, done:true, result:{ids, types, args}});
    } else if (m.op === 'bench') {
      // 线程基准：纯浮点运算
      let acc=0; const N=m.n||4e6;
      for(let i=0;i<N;i++) acc+=Math.sqrt(i)*Math.sin(i*0.0001);
      self.postMessage({id,done:true,result:acc});
    } else {
      self.postMessage({id,done:true,result:null});
    }
  } catch(err){
    self.postMessage({id,error:String(err&&err.message||err)});
  }
};
`;

export interface Task {
  op: "thickness" | "draft" | "mass" | "hlr" | "bench" | "stepFaces" | "stepScan";
  [k: string]: unknown;
}

interface Pending {
  resolve: (v: any) => void;
  reject: (e: any) => void;
  onProgress?: (p: number) => void;
}

export class WorkerPool {
  private workers: Worker[] = [];
  private pending = new Map<number, Pending>();
  private seq = 0;
  private url: string;
  busy = 0;

  constructor(public size: number) {
    const blob = new Blob([WORKER_SRC], { type: "text/javascript" });
    this.url = URL.createObjectURL(blob);
    this.resize(size);
  }

  resize(size: number) {
    this.size = Math.max(1, Math.min(64, size | 0));
    while (this.workers.length > this.size) this.workers.pop()?.terminate();
    while (this.workers.length < this.size) {
      const w = new Worker(this.url);
      w.onmessage = (ev: MessageEvent) => {
        const d = ev.data;
        const p = this.pending.get(d.id);
        if (!p) return;
        if (d.progress !== undefined) {
          p.onProgress?.(d.progress);
          return;
        }
        this.pending.delete(d.id);
        this.busy = Math.max(0, this.busy - 1);
        if (d.error) p.reject(new Error(d.error));
        else p.resolve(d.result);
      };
      this.workers.push(w);
    }
  }

  run(worker: number, task: Task, onProgress?: (p: number) => void): Promise<any> {
    const id = ++this.seq;
    const w = this.workers[worker % this.workers.length];
    this.busy++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      w.postMessage({ ...task, id });
    });
  }

  /** 把 [0,total) 均分给所有线程并发执行 */
  async parallel(
    total: number,
    make: (start: number, end: number) => Task,
    onProgress?: (p: number) => void,
  ): Promise<any[]> {
    const n = Math.min(this.size, Math.max(1, Math.ceil(total / 64)));
    const chunk = Math.ceil(total / n);
    const progress = new Array(n).fill(0);
    const jobs: Promise<any>[] = [];
    for (let i = 0; i < n; i++) {
      const start = i * chunk;
      const end = Math.min(total, start + chunk);
      if (start >= end) continue;
      jobs.push(
        this.run(i, make(start, end), (p) => {
          progress[i] = p;
          onProgress?.(progress.reduce((a, b) => a + b, 0) / n);
        }),
      );
    }
    return Promise.all(jobs);
  }

  dispose() {
    this.workers.forEach((w) => w.terminate());
    this.workers = [];
    URL.revokeObjectURL(this.url);
  }
}

let pool: WorkerPool | null = null;
export function getPool(size?: number): WorkerPool {
  const want = size ?? (navigator.hardwareConcurrency || 4);
  if (!pool) pool = new WorkerPool(want);
  else if (size && size !== pool.size) pool.resize(size);
  return pool;
}

export function cpuThreads(): number {
  return navigator.hardwareConcurrency || 4;
}

export function gpuInfo(): { renderer: string; vendor: string; webgl2: boolean; maxTex: number } {
  try {
    const c = document.createElement("canvas");
    const gl = (c.getContext("webgl2") || c.getContext("webgl")) as WebGLRenderingContext | null;
    if (!gl) return { renderer: "无 WebGL", vendor: "-", webgl2: false, maxTex: 0 };
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      renderer: dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER)),
      vendor: dbg ? String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL)) : String(gl.getParameter(gl.VENDOR)),
      webgl2: !!c.getContext("webgl2"),
      maxTex: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
    };
  } catch {
    return { renderer: "未知", vendor: "-", webgl2: false, maxTex: 0 };
  }
}
