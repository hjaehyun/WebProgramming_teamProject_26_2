import { exhibitionImageGet } from "@/server/exhibition-handlers";
export async function GET(_request:Request,ctx:{params:Promise<{id:string;date:string}>}) { const {id,date}=await ctx.params;return exhibitionImageGet(id,date); }
