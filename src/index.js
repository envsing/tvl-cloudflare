const PLACE_IDS = [
  "10561456271",
  "10561483644",
  "10561484691"
];

function fmtDate(dateString) {
  return new Date(dateString).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo"
  });
}

async function getUniverseId(placeId) {
  const res = await fetch(
    `https://apis.roblox.com/universes/v1/places/${placeId}/universe`,
    {
      headers: { accept: "application/json" }
    }
  );

  if (!res.ok) {
    throw new Error(`Erro ao buscar universeId do place ${placeId}: ${res.status}`);
  }

  const data = await res.json();

  if (!data?.universeId) {
    throw new Error(`UniverseId não encontrado para place ${placeId}`);
  }

  return String(data.universeId);
}

async function getGames(universeIds) {
  const res = await fetch(
    `https://games.roblox.com/v1/games?universeIds=${universeIds.join(",")}`,
    {
      headers: { accept: "application/json" }
    }
  );

  if (!res.ok) {
    throw new Error(`Erro ao buscar jogos: ${res.status}`);
  }

  const data = await res.json();

  if (!data?.data || !Array.isArray(data.data)) {
    throw new Error("Resposta inválida da API de jogos");
  }

  return data.data;
}

async function sendDiscordMessage(webhookUrl, roleId, games) {
  const embeds = games.map((game) => ({
    title: "TVL Update Tracker",
    description: `**${game.name}** foi atualizado.`,
    url: `https://www.roblox.com/games/${game.rootPlaceId}`,
    color: 0,
    fields: [
      {
        name: "Nome do jogo",
        value: game.name,
        inline: false
      },
      {
        name: "Horário da atualização",
        value: fmtDate(game.updated),
        inline: false
      },
      {
        name: "Link do jogo",
        value: `[Abrir jogo](https://www.roblox.com/games/${game.rootPlaceId})`,
        inline: false
      }
    ],
    footer: {
      text: "TVL Update Tracker"
    },
    timestamp: new Date(game.updated).toISOString()
  }));

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      content: `<@&${roleId}>`,
      allowed_mentions: {
        roles: [roleId]
      },
      embeds
    })
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Erro ao enviar webhook: ${res.status} - ${text}`);
  }
}

async function runCheck(env) {
  const webhook = env.DISCORD_WEBHOOK_URL;
  const roleId = env.ROLE_ID;

  if (!webhook) {
    throw new Error("DISCORD_WEBHOOK_URL não definida");
  }

  const universeIds = await Promise.all(PLACE_IDS.map(getUniverseId));
  const uniqueIds = [...new Set(universeIds)];
  const games = await getGames(uniqueIds);

  const updatedGames = [];

  for (const game of games) {
    if (!game?.updated) continue;

    const key = `last_updated:${game.id}`;
    const previous = await env.TVL_KV.get(key);

    if (previous !== game.updated) {
      updatedGames.push(game);
      await env.TVL_KV.put(key, game.updated);
    }
  }

  if (updatedGames.length > 0) {
    await sendDiscordMessage(webhook, roleId, updatedGames);
  }

  return {
    ok: true,
    checked: games.map((game) => ({
      name: game.name,
      universeId: game.id,
      rootPlaceId: game.rootPlaceId,
      updated: game.updated
    })),
    updatedDetected: updatedGames.map((game) => ({
      name: game.name,
      universeId: game.id,
      rootPlaceId: game.rootPlaceId,
      updated: game.updated
    }))
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/check") {
      try {
        const result = await runCheck(env);
        return Response.json(result, { status: 200 });
      } catch (e) {
        return Response.json(
          { ok: false, error: e?.message || "Erro interno" },
          { status: 500 }
        );
      }
    }

    return new Response("ok", { status: 200 });
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runCheck(env));
  }
};
