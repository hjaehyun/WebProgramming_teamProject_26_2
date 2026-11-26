import { resendConfirmation } from "@/server/auth-handlers";

export function POST(request: Request) { return resendConfirmation(request); }
