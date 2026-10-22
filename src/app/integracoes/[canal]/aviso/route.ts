import { NextResponse } from "next/server";

// Endereço de notificações pedido pelo Mercado Livre ao criar o aplicativo. O
// sistema só confirma o recebimento: as vendas entram pelo botão "Buscar
// vendas agora", com a pessoa logada.
export function POST() {
  return new NextResponse(null, { status: 200 });
}

export function GET() {
  return new NextResponse(null, { status: 200 });
}
