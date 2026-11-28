import { trashRestore } from "@/server/trash-handlers";
export async function POST(request:Request,ctx:{params:Promise<{id:string}>}) { return trashRestore(request,(await ctx.params).id); }
