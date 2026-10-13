"use client";
import {useEffect,useRef} from 'react';
import type {CSSProperties} from 'react';

export default function SilentBackgroundVideo({src,poster,style}:{src:string;poster:string;style:CSSProperties}){
 const ref=useRef<HTMLVideoElement>(null);
 useEffect(()=>{
  const v=ref.current;if(!v)return;
  const start=()=>{if(document.visibilityState==='hidden')return;v.muted=true;v.defaultMuted=true;v.volume=0;v.playsInline=true;void v.play().catch(()=>{});};
  v.addEventListener('canplay',start);document.addEventListener('visibilitychange',start);start();
  return()=>{v.removeEventListener('canplay',start);document.removeEventListener('visibilitychange',start);};
 },[src]);
 return <video ref={ref} className="silent-background-video" src={src} poster={poster} style={style} controls={false} autoPlay muted loop playsInline preload="auto" aria-hidden="true" {...{'webkit-playsinline':''}}/>;
}
