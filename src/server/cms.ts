import type { AdminCtx, AdminResult } from "./admin";
import { authorizeAdmin } from "./admin";
import type { Db } from "./store";
import { newId } from "./store";
import type { CmsCity, SiteSettings } from "./types";

export const DEFAULT_SETTINGS: SiteSettings = { title:"Run Local", wordmark:"Run Local", tagline:"Find your local run.", primary:"#0b2b22", accent:"#c8f169", surface:"#f7f8f3", strings:{}, tags:{runTypes:["Social run","Track","Trail","Long run"],credentialBodies:["RRCA"],qa:["Training","Shoes","Routes"],ratings:["Easy","Moderate","Hard"]}, providers:{strava:true,garmin:true,coros:true,suunto:true}, bottomNav:["home","races","clubs","forum"], announcement:null, logoRef:null, faviconRef:null };
const hex=(v:unknown)=>typeof v==="string"&&/^#[0-9a-f]{6}$/i.test(v);
const https=(v:unknown)=>v===null||v===undefined||(typeof v==="string"&&/^https:\/\//i.test(v));
export function publicSettings(db:Db){ return db.getSettings(DEFAULT_SETTINGS); }
function safe(s:SiteSettings){ return {...s, secrets:undefined}; }
export function updateSettings(db:Db,ctx:AdminCtx,input:Partial<SiteSettings>,now=new Date()):AdminResult<{settings:SiteSettings}>{
 const auth=authorizeAdmin(db,ctx,"admin.cms_settings",null,now); if(!auth.ok)return auth as any;
 const prev=db.getSettings(DEFAULT_SETTINGS); const next={...prev,...input,strings:{...prev.strings,...(input.strings??{})},tags:{...prev.tags,...(input.tags??{})},providers:{...prev.providers,...(input.providers??{})}};
 if(!hex(next.primary)||!hex(next.accent)||!hex(next.surface))return {ok:false,status:400,error:"invalid_color"}; if(!https(next.announcement?.link??null))return {ok:false,status:400,error:"invalid_url"};
 db.setSettings(next); db.appendAudit({admin:auth.data.admin,action:"admin.cms_settings",reason:ctx.reason!.trim(),targetId:null,ip:ctx.ip},now); return {ok:true,data:{settings:safe(next)}};
}
export function saveCity(db:Db,ctx:AdminCtx,input:Partial<CmsCity>&{id?:string},now=new Date()):AdminResult<{city:CmsCity}>{
 const auth=authorizeAdmin(db,ctx,"admin.cms_city",input.id??null,now);if(!auth.ok)return auth as any;
 if(typeof input.name!=="string"||typeof input.state!=="string"||typeof input.slug!=="string"||!/^[a-z0-9-]{2,50}$/.test(input.slug))return {ok:false,status:400,error:"invalid_city"};
 const prev=input.id?db.getCity(input.id):undefined; const city:CmsCity={id:input.id??newId(),name:input.name.trim().slice(0,80),state:input.state.trim().slice(0,40),slug:input.slug,status:input.status==="inactive"?"inactive":"active",headerImageRef:input.headerImageRef??prev?.headerImageRef??null,accent:hex(input.accent)?input.accent!:prev?.accent??null}; db.setCity(city); return {ok:true,data:{city}};
}
export function deleteCity(db:Db,ctx:AdminCtx,id:string,now=new Date()):AdminResult<{city:CmsCity}>{const a=authorizeAdmin(db,ctx,"admin.cms_city",id,now);if(!a.ok)return a as any;const c=db.getCity(id);if(!c)return {ok:false,status:404,error:"not_found"};c.status="inactive";db.setCity(c);return {ok:true,data:{city:c}};}
export function validateUpload(data:unknown){if(typeof data!=="string"||!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=\s]+$/.test(data))return false;return Buffer.from(data.split(",")[1].replace(/\s/g,""),"base64").length<=4*1024*1024;}
