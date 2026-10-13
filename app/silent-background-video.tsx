"use client";
import {useEffect,useRef,useState} from 'react';
import type {CSSProperties} from 'react';

export default function SilentBackgroundVideo({src,poster,style}:{src:string;poster:string;style:CSSProperties}){
 const ref=useRef<HTMLVideoElement>(null);
 const [blocked,setBlocked]=useState(false);
 useEffect(()=>{
  const v=ref.current;if(!v)return;
  let active=true;
  const start=()=>{if(document.visibilityState==='hidden')return;v.muted=true;v.defaultMuted=true;v.volume=0;v.playsInline=true;void v.play().then(()=>{if(active)setBlocked(false)}).catch(()=>{if(active)setBlocked(true)});};
  v.addEventListener('canplay',start);document.addEventListener('visibilitychange',start);start();
  return()=>{active=false;v.removeEventListener('canplay',start);document.removeEventListener('visibilitychange',start);};
 },[src]);
 return <><video ref={ref} className="silent-background-video" src={src} poster={poster} style={style} autoPlay muted loop playsInline preload="auto" aria-hidden="true" {...{'webkit-playsinline':''}}/><button className="background-video-play" hidden={!blocked} type="button" onClick={()=>{const v=ref.current;if(v){v.muted=true;void v.play().then(()=>setBlocked(false)).catch(()=>setBlocked(true));}}}>Παίξε το βίντεο ▷</button></>;
}
