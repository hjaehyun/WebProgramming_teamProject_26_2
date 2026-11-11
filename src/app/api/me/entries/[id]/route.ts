import { entryChange } from "@/server/entry-handlers";
type Context = { params: Promise<{id:string}> };
export async function PATCH(request: Request,ctx: Context) { return entryChange(request,(await ctx.params).id); }
export async function DELETE(request: Request,ctx: Context) { return entryChange(request,(await ctx.params).id,true); }
