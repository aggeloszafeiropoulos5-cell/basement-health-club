"use client";
import {createContext,useContext,useEffect,useState,type CSSProperties,type ReactNode} from "react";
import {api} from "./supabase-rest";

export const referenceColors={primary:"#7138dc",header:"#202c43",background:"#f5f6fa",green:"#07864d",orange:"#c35a06",red:"#ce2949",blue:"#0774d1"};
export type ControlConfig={name:string;subtitle:string;colors:typeof referenceColors;step:number;defaultView:string;lowSessions:number;expiryDays:number;inactiveDays:number;calendarColorMode:string};
export const referenceConfig:ControlConfig={name:"BASEMENT",subtitle:"HEALTH CLUB",colors:referenceColors,step:60,defaultView:"day",lowSessions:1,expiryDays:7,inactiveDays:30,calendarColorMode:"status"};
export function cleanConfig(value:Partial<ControlConfig>|null):ControlConfig{
 const c={...referenceConfig,...value,colors:{...referenceColors}};
 for(const key of Object.keys(referenceColors) as (keyof typeof referenceColors)[]){const v=value?.colors?.[key];if(v&&/^#[0-9a-f]{6}$/i.test(v))c.colors[key]=v;}
 return c;
}
const Theme=createContext({config:referenceConfig,refresh:()=>{}});
export const useControlTheme=()=>useContext(Theme);
export function ControlTheme({children}:{children:ReactNode}){
 const [config,setConfig]=useState(referenceConfig),[revision,setRevision]=useState(0);
 useEffect(()=>{let live=true;void api("/rest/v1/rpc/basement_brand_config",localStorage.getItem("basement_access_token")||"",{method:"POST",body:"{}"}).then(async r=>{if(r.ok&&live)setConfig(cleanConfig(await r.json()))}).catch(()=>{});return()=>{live=false}},[revision]);
 const style={"--primary":config.colors.primary,"--club-primary":config.colors.primary,"--club-header":config.colors.header,"--club-background":config.colors.background,...Object.fromEntries(Object.entries(config.colors).map(([key,value])=>[`--club-${key}`,value]))} as CSSProperties;
 return <Theme.Provider value={{config,refresh:()=>setRevision(n=>n+1)}}><div className="reference-theme" style={style}>{children}</div></Theme.Provider>;
}
