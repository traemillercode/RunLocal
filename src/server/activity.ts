import { randomBytes, createHash } from "node:crypto";
import type { Db } from "./store";

export type Provider = "strava" | "garmin" | "coros" | "suunto";
export type ShareMode = "auto" | "manual" | "private";
export interface Activity { id:string; accountId:string; provider:Provider; type:string; distanceMeters:number; durationSeconds:number; completedAt:string; shareMode:ShareMode; caption?:string|null; }
export interface ActivityCard { id:string; type:string; distanceMeters:number; durationSeconds:number; provider:Provider; attribution:string; sharedAt:string; }
export interface OAuthToken { accountId:string; provider:Provider; accessToken:string; refreshToken:string|null; expiresAt:number|null; providerUserId:string|null; }
export interface ProviderAdapter { provider:Provider; attribution:string; configured():boolean; authorizeUrl(state:string):string; exchange(code:string):Promise<{accessToken:string;refreshToken?:string;expiresAt?:number;providerUserId?:string}>; revoke(token:string):Promise<void>; normalize(raw:unknown):Omit<Activity,"id"|"accountId"|"shareMode">; }
const attribution:Record<Provider,string>={strava:"Strava",garmin:"Garmin",coros:"Coros",suunto:"Suunto"};
export function normalizeActivity(provider:Provider, raw:unknown): Omit<Activity,"id"|"accountId"|"shareMode"> {
 const x=raw as Record<string,unknown>; const type=String(x.type??x.sport_type??"run").toLowerCase();
 const distanceMeters=Number(x.distanceMeters??x.distance??0); const durationSeconds=Number(x.durationSeconds??x.moving_time??x.duration??0);
 if(!Number.isFinite(distanceMeters)||distanceMeters<0||!Number.isFinite(durationSeconds)||durationSeconds<0) throw new Error("invalid_activity");
 return {provider,type,distanceMeters,durationSeconds,completedAt:String(x.completedAt??x.start_date??new Date().toISOString()),caption:null};
}
export function cardForActivity(a:Activity):ActivityCard { return {id:a.id,type:a.type,distanceMeters:a.distanceMeters,durationSeconds:a.durationSeconds,provider:a.provider,attribution:attribution[a.provider],sharedAt:a.completedAt}; }
export function configured(provider:Provider):boolean { if(provider!=="strava") return false; return Boolean(process.env.STRAVA_CLIENT_ID&&process.env.STRAVA_CLIENT_SECRET&&process.env.STRAVA_REDIRECT_URI); }
function missing(provider:Provider):string[] { if(provider!=="strava") return ["approved_provider_credentials"]; return ["STRAVA_CLIENT_ID","STRAVA_CLIENT_SECRET","STRAVA_REDIRECT_URI"].filter(k=>!process.env[k]); }
export class StravaAdapter implements ProviderAdapter { provider="strava" as const; attribution="Strava"; configured=()=>configured("strava"); authorizeUrl(state:string){if(!this.configured()) throw new Error("provider_not_configured"); const q=new URLSearchParams({client_id:process.env.STRAVA_CLIENT_ID!,redirect_uri:process.env.STRAVA_REDIRECT_URI!,response_type:"code",approval_prompt:"auto",scope:"read,activity:read",state}); return `https://www.strava.com/oauth/authorize?${q}`; } async exchange(code:string){if(!this.configured()) throw new Error("provider_not_configured"); const r=await fetch("https://www.strava.com/oauth/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:process.env.STRAVA_CLIENT_ID!,client_secret:process.env.STRAVA_CLIENT_SECRET!,code,grant_type:"authorization_code"})}); if(!r.ok) throw new Error("oauth_exchange_failed"); const x=await r.json() as any; return {accessToken:String(x.access_token),refreshToken:x.refresh_token?String(x.refresh_token):undefined,expiresAt:Number(x.expires_at)||undefined,providerUserId:x.athlete?.id?String(x.athlete.id):undefined}; } async revoke(token:string){if(!this.configured()) return; await fetch("https://www.strava.com/oauth/deauthorize",{method:"POST",headers:{authorization:`Bearer ${token}`}}); } normalize(raw:unknown){return normalizeActivity("strava",raw);} }
/** Garmin Health/Activity API requires an approved business application and Powered by Garmin attribution. */
export class GarminAdapter implements ProviderAdapter { provider="garmin" as const; attribution="Garmin"; configured=()=>false; authorizeUrl(){throw new Error("provider_not_configured");} async exchange(){throw new Error("provider_not_configured");} async revoke(){/* scaffold */} normalize(raw:unknown){return normalizeActivity("garmin",raw);} }
/** Coros OAuth2 scaffold: production credentials and approved scopes are required. */
export class CorosAdapter extends GarminAdapter { provider="coros" as const; attribution="Coros"; normalize(raw:unknown){return normalizeActivity("coros",raw);} }
/** Suunto Cloud adapter scaffold; requires Partner Program/API agreement. */
export class SuuntoAdapter extends GarminAdapter { provider="suunto" as const; attribution="Suunto"; normalize(raw:unknown){return normalizeActivity("suunto",raw);} }
export const adapters:Record<Provider,ProviderAdapter>={strava:new StravaAdapter(),garmin:new GarminAdapter(),coros:new CorosAdapter(),suunto:new SuuntoAdapter()};
const pendingStates = new Map<string,{accountId:string;provider:Provider;expires:number}>();
export function oauthState(accountId:string,provider:Provider){const nonce=randomBytes(24).toString("hex"); pendingStates.set(nonce,{accountId,provider,expires:Date.now()+10*60_000}); return nonce;}
export function stateValid(state:string,accountId:string,provider:Provider){const entry=pendingStates.get(state); if(!entry||entry.expires<Date.now()||entry.accountId!==accountId||entry.provider!==provider)return false; pendingStates.delete(state); return true;}
export function configError(provider:Provider){return {error:"provider_not_configured",provider,missing:missing(provider)};}
export function publicActivityCard(a:Activity){return cardForActivity(a);}
export function canShare(account: {status:string}, mode:ShareMode){return account.status==="verified"&&mode!=="private";}
export function autoCard(a:Activity){return a.shareMode==="auto"?cardForActivity(a):null;}
