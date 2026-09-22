import type { Metadata,Viewport } from "next";
import "./globals.css";
import "./dashboard.css";
export const metadata: Metadata={title:"Basement Health Club",description:"Online κρατήσεις και υπηρεσίες του Basement Health Club.",manifest:"/manifest.webmanifest",appleWebApp:{capable:true,title:"Basement",statusBarStyle:"black-translucent"},icons:{apple:"/basement-logo.jpeg"}};
export const viewport:Viewport={themeColor:"#8038df"};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="el"><body>{children}</body></html>}
