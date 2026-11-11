import { exhibitionGet } from "@/server/exhibition-handlers";
export async function GET(_request:Request,ctx:{params:Promise<{id:string}>}) { return exhibitionGet((await ctx.params).id); }
