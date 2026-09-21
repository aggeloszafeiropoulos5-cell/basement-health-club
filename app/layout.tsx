import type { Metadata } from "next";
import "./globals.css";
import "./dashboard.css";
export const metadata: Metadata={title:"Basement Health Club",description:"Online κρατήσεις και υπηρεσίες του Basement Health Club."};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="el"><body>{children}</body></html>}
