export const SUPABASE_URL="https://nzuntubppzyegarujhak.supabase.co";
export const SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im56dW50dWJwcHp5ZWdhcnVqaGFrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk5MzQ1MjAsImV4cCI6MjEwNTUxMDUyMH0.gOYjNHo00DKVTdmWRK2FwRozgZKPyIX4ZzHm0wNOdCo";

export async function api(path:string,token?:string,init:RequestInit={}){
  return fetch(`${SUPABASE_URL}${path}`,{...init,headers:{apikey:SUPABASE_ANON_KEY,"Content-Type":"application/json",...(token?{Authorization:`Bearer ${token}`}:{}) ,...(init.headers||{})}});
}
