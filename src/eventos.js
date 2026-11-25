// Notificações em tempo real via Server-Sent Events (SSE).
// Cada navegador conectado recebe os eventos destinados ao seu papel ou ao seu usuário.
class Eventos {
  constructor() {
    this.conexoes = new Set();
  }

  conectar(req, res) {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write('retry: 5000\n\n');
    const conexao = { res, usuario: req.usuario };
    this.conexoes.add(conexao);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => {
      clearInterval(ping);
      this.conexoes.delete(conexao);
    });
  }

  // destino: { papeis?: string[], usuarioIds?: number[] }. Gestor recebe tudo.
  emitir(tipo, dados, destino = {}) {
    const msg = `event: ${tipo}\ndata: ${JSON.stringify(dados)}\n\n`;
    for (const c of this.conexoes) {
      const u = c.usuario;
      const alvo =
        u.papel === 'gestor' ||
        (destino.papeis || []).includes(u.papel) ||
        (destino.usuarioIds || []).includes(u.id);
      if (alvo) c.res.write(msg);
    }
  }

  fecharTodas() {
    for (const c of this.conexoes) c.res.end();
    this.conexoes.clear();
  }
}

module.exports = { Eventos };
