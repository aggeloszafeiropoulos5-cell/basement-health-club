export const SUPABASE_URL="https://nzuntubppzyegarujhak.supabase.co";
export const SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im56dW50dWJwcHp5ZWdhcnVqaGFrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk5MzQ1MjAsImV4cCI6MjEwNTUxMDUyMH0.gOYjNHo00DKVTdmWRK2FwRozgZKPyIX4ZzHm0wNOdCo";

export async function api(path:string,token?:string,init:RequestInit={}){
  const managed=!!token && typeof window!=="undefined";
  if(managed) token=await (await import("./session")).accessToken();
  const send=()=>{
    const headers=new Headers(init.headers);
    headers.set("apikey",SUPABASE_ANON_KEY);
    if(!headers.has("Content-Type"))headers.set("Content-Type","application/json");
    if(token)headers.set("Authorization",`Bearer ${token}`);
    return fetch(`${SUPABASE_URL}${path}`,{...init,headers,cache:"no-store"});
  };
  const response=await send();
  if(!managed||response.status!==401)return response;
  const data=await response.clone().json().catch(()=>({}));
  // PostgREST rejects expired JWTs before executing a query or RPC.
  if(!["bad_jwt","jwt_expired","session_expired","session_not_found","PGRST301","PGRST303"].includes(data.error_code||data.code))return response;
  token=await (await import("./session")).accessToken(token);
  return send();
}
