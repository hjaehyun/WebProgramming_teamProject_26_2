import { trashEmpty, trashList } from "@/server/trash-handlers";
export async function GET() { return trashList(); }
export async function DELETE(request:Request) { return trashEmpty(request); }
