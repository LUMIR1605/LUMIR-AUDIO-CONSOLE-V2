const key = "lumir-v2-lighting";
const defaults = Object.freeze({ speakerEnabled:true, mode:"slow-cycle", staticColor:"gold", cycleSeconds:45, brightness:48, activityEnabled:true, activityAmount:46, centerStandby:true, bassGlow:false });
export function createAppState() {
  let lighting;
  try { lighting = { ...defaults, ...JSON.parse(localStorage.getItem(key) || "{}") }; } catch { lighting = { ...defaults }; }
  const listeners = new Set();
  return Object.freeze({
    playback:Object.freeze({status:"idle",currentTrackId:null}), session:Object.freeze({selectedCenter:"cosmic-core",presetId:"cosmos"}),
    getLighting:()=>({...lighting}), updateLighting:(patch)=>{ lighting={...lighting,...patch}; try{localStorage.setItem(key,JSON.stringify(lighting));}catch{} listeners.forEach(fn=>fn(lighting)); },
    subscribeLighting:(fn)=>{listeners.add(fn);return()=>listeners.delete(fn);}
  });
}
