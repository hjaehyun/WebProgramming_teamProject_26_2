import { trashPurge } from "@/server/trash-handlers";
export async function DELETE(request:Request,ctx:{params:Promise<{id:string}>}) { return trashPurge(request,(await ctx.params).id); }
