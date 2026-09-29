"use client";
import {useEffect,useState} from "react";

/** Device-only display settings. Storage failures must never block the dashboard. */
export function useDisplayPreference(key:string,initial:number,min:number,max:number){
  const [value,setValue]=useState(initial);
  useEffect(()=>{try{const saved=localStorage.getItem(key);if(saved!==null&&saved.trim()!==""){const parsed=Number(saved);if(Number.isFinite(parsed))setValue(Math.min(max,Math.max(min,Math.round(parsed))))}}catch{}},[key,min,max]);
  function update(next:number){const safe=Number.isFinite(next)?Math.min(max,Math.max(min,Math.round(next))):initial;setValue(safe);try{localStorage.setItem(key,String(safe))}catch{}}
  return [value,update] as const;
}
