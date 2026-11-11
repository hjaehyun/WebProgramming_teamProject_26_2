import { auth } from "@/server/auth-handlers";
export function POST(request: Request) { return auth(request,"login"); }
