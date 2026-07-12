const { Telegraf } = require('telegraf');
const axios = require('axios');
const { Pool } = require('pg');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const fs = require('fs');

// Token oficial NUEVO y actualizado
const bot = new Telegraf('8664870579:AAH-H8QYIA5qIA5z4HfszktMNI9viBDj08E'); 

// IDs de los Dueños Absolutos (Owner)
const OWNER_IDS = [8116120039, 7703974919, 8459877936];

// Enlace oficial de tu base de datos PostgreSQL en Render
const POSTGRES_URL = "postgresql://cuervo:0EeaYwdcpetEi110JkCEbKaxibckNAp4@dpg-d999nn8k1i2s73dsr5ug-a.oregon-postgres.render.com/ojodios";

// Configuración de la conexión a PostgreSQL (optimizada)
const pool = new Pool({
    connectionString: POSTGRES_URL,
    ssl: { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});

// Conexión a Supabase
const SUPABASE_URL = "https://gactklxmkxmvirmsustj.supabase.co";
const SUPABASE_KEY = "sb_publishable_T4hxvg-E8GeCUwuStwR_pg_vZI5O1ZH";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Control de estados en memoria (temporal por consulta)
const esperandoNumero = {};

// Cache optimizado con TTL (5 minutos para consultas, 2 minutos para permisos)
const cacheConsultas = {};
const cachePermisos = {};
const CACHE_TTL_CONSULTA = 5 * 60 * 1000;
const CACHE_TTL_PERMISO = 2 * 60 * 1000;

function setCache(cache, key, value, ttl) {
    cache[key] = { value, expires: Date.now() + ttl };
}

function getCache(cache, key) {
    const item = cache[key];
    if (!item || Date.now() > item.expires) {
        delete cache[key];
        return null;
    }
    return item.value;
}

function limpiarCaches() {
    const now = Date.now();
    for (const key of Object.keys(cacheConsultas)) {
        if (cacheConsultas[key] && cacheConsultas[key].expires < now) delete cacheConsultas[key];
    }
    for (const key of Object.keys(cachePermisos)) {
        if (cachePermisos[key] && cachePermisos[key].expires < now) delete cachePermisos[key];
    }
}
setInterval(limpiarCaches, 60000); 

// --- CREACIÓN DE TABLAS AUTOMÁTICA ---
async function iniciarBD() {
    try {
        // Tabla de Vendedores
        await pool.query(`
            CREATE TABLE IF NOT EXISTS sellers (
                seller_id BIGINT PRIMARY KEY
            );
        `);
        // Tabla de Clientes VIP
        await pool.query(`
            CREATE TABLE IF NOT EXISTS vips (
                cliente_id BIGINT PRIMARY KEY,
                acceso TEXT,
                fecha_activacion TIMESTAMP DEFAULT NOW()
            );
        `);
        
        // Migrar tabla si no tiene columna fecha_activacion
        await pool.query(`
            DO $$ BEGIN
                ALTER TABLE vips ADD COLUMN IF NOT EXISTS fecha_activacion TIMESTAMP DEFAULT NOW();
            EXCEPTION WHEN duplicate_column THEN null;
            END $$;
        `);
        
        console.log("📦 PostgreSQL listo y tablas verificadas con éxito.");
    } catch (err) {
        console.error("❌ Error al inicializar tablas en Postgres:", err);
    }
}
iniciarBD();

// --- VALIDAR ACCESOS (optimizado con caché) ---
async function verificarAcceso(ctx) {
    const userId = ctx.from.id;
    if (OWNER_IDS.includes(userId)) return true;

    // Verificar caché de permisos primero
    const cacheKey = `perm_${userId}`;
    const cached = getCache(cachePermisos, cacheKey);
    if (cached !== null) return cached;

    try {
        // Query combinada: seller + VIP en una sola consulta
        const result = await pool.query(
            `SELECT 
                (SELECT 1 FROM sellers WHERE seller_id = $1) as es_seller,
                (SELECT acceso FROM vips WHERE cliente_id = $1) as acceso`,
            [userId]
        );

        const row = result.rows[0];
        
        if (row.es_seller) {
            setCache(cachePermisos, cacheKey, true, CACHE_TTL_PERMISO);
            return true;
        }

        if (!row.acceso) {
            ctx.reply("❌ No tienes acceso, compra tu acceso con @El_CuervoX");
            setCache(cachePermisos, cacheKey, false, 30000);
            return false;
        }

        if (row.acceso === 'perm') {
            setCache(cachePermisos, cacheKey, true, CACHE_TTL_PERMISO);
            return true;
        }

        if (new Date(row.acceso) > new Date()) {
            setCache(cachePermisos, cacheKey, true, CACHE_TTL_PERMISO);
            return true;
        } else {
            ctx.reply("❌ RENUEVA TU ACCESO CON @El_CuervoX");
            setCache(cachePermisos, cacheKey, false, 30000);
            return false;
        }
    } catch (e) {
        console.error(e);
        ctx.reply("⚠️ Error temporal al verificar acceso.");
        return false;
    }
}

async function enviarStart(ctx) {
    const userId = ctx.from.id;
    const username = ctx.from.username ? `@${ctx.from.username}` : "No configurado";
    const nombreCompleto = `${ctx.from.first_name} ${ctx.from.last_name || ''}`.trim();
    
    let tipoMembresia = "❌ Sin acceso activo";

    if (OWNER_IDS.includes(userId)) {
        tipoMembresia = "👑 Owner / Creador";
    } else {
        try {
            // Query optimizada combinada
            const result = await pool.query(
                `SELECT 
                    (SELECT 1 FROM sellers WHERE seller_id = $1) as es_seller,
                    (SELECT acceso FROM vips WHERE cliente_id = $1) as acceso`,
                [userId]
            );
            const row = result.rows[0];
            
            if (row.es_seller) {
                tipoMembresia = "💼 Seller / Vendedor Autorizado";
            } else if (row.acceso) {
                if (row.acceso === 'perm') {
                    tipoMembresia = "💎 VIP Permanente";
                } else if (new Date(row.acceso) > new Date()) {
                    const fechaFormat = new Date(row.acceso).toISOString().split('T')[0];
                    tipoMembresia = `⏱️ VIP Activo (Vence: ${fechaFormat})`;
                } else {
                    tipoMembresia = "❌ Membresía Expirada";
                }
            }
        } catch (e) {
            tipoMembresia = "⚠️ Error de lectura";
        }
    }

    let bienvenidaPanel = `👁️ <b>¡Bienvenido al Ojo de Dios!</b> \n`;
    bienvenidaPanel += `Para realizar una consulta presiona el comando /nequi\n\n`;
    bienvenidaPanel += `╔════════════════════════╗\n`;
    bienvenidaPanel += `   👤   <b>MI PERFIL DE ACCESO</b> \n`;
    bienvenidaPanel += `╚════════════════════════╝\n\n`;
    bienvenidaPanel += `🆔 <b>Tu ID:</b> <code>${userId}</code>\n`;
    bienvenidaPanel += `👤 <b>Usuario:</b> ${username}\n`;
    bienvenidaPanel += `📝 <b>Nombre:</b> <code>${nombreCompleto}</code>\n`; 
    bienvenidaPanel += `🏅 <b>Membresía:</b> <b>${tipoMembresia}</b>\n`;
    bienvenidaPanel += `─────────────────────────\n`;
    bienvenidaPanel += `✨ <b>by : @El_CuervoX & @DarkNull1</b>`;

    ctx.reply(bienvenidaPanel, { parse_mode: 'HTML' });
}

bot.start((ctx) => { enviarStart(ctx); });

bot.command('menu', async (ctx) => {
    const userId = ctx.from.id;
    let tipoMembresia = "❌ Sin acceso";

    if (OWNER_IDS.includes(userId)) {
        tipoMembresia = "👑 Owner";
    } else {
        try {
            const result = await pool.query(
                `SELECT (SELECT 1 FROM sellers WHERE seller_id = $1) as es_seller, (SELECT acceso FROM vips WHERE cliente_id = $1) as acceso`,
                [userId]
            );
            const row = result.rows[0];
            if (row.es_seller) tipoMembresia = "💼 Seller";
            else if (row.acceso === 'perm') tipoMembresia = "💎 VIP Permanente";
            else if (row.acceso && new Date(row.acceso) > new Date()) tipoMembresia = "⏱️ VIP Activo";
            else if (row.acceso) tipoMembresia = "❌ Expirado";
        } catch (e) {}
    }

    let menu = `╔════════════════════════════╗\n`;
    menu += `       👁️ <b>EL OJO DE DIOS</b>\n`;
    menu += `╚════════════════════════════╝\n\n`;
    menu += `🏅 <b>Tu Membresía:</b> <code>${tipoMembresia}</code>\n`;
    menu += `───────────────────────────────\n\n`;
    menu += `📋 <b>MENÚ PRINCIPAL</b>\n\n`;
    menu += `🔹 /perfil - Ver tu perfil completo\n`;
    menu += `🔹 /nequi - Consultar número\n`;
    menu += `🔹 /comprar - Comprar acceso\n`;
    menu += `🔹 /recargar - Recargar tu cuenta\n`;
    menu += `───────────────────────────────\n`;
    menu += `✨ <b>by @El_CuervoX & @DarkNull1</b>`;

    ctx.reply(menu, { parse_mode: 'HTML' });
});

bot.command('perfil', async (ctx) => {
    const userId = ctx.from.id;
    const username = ctx.from.username ? `@${ctx.from.username}` : "Sin username";
    const nombre = `${ctx.from.first_name} ${ctx.from.last_name || ''}`.trim();
    
    let tipoMembresia = "❌ Sin acceso";
    let fechaActivacion = "N/A";
    let fechaExpiracion = "N/A";

    if (OWNER_IDS.includes(userId)) {
        tipoMembresia = "👑 Owner / Creador";
        fechaActivacion = "∞ Permanente";
        fechaExpiracion = "∞ Permanente";
    } else {
        try {
            const result = await pool.query(
                `SELECT (SELECT 1 FROM sellers WHERE seller_id = $1) as es_seller, acceso, fecha_activacion FROM vips WHERE cliente_id = $1`,
                [userId]
            );
            const row = result.rows[0];
            
            if (row && row.es_seller) {
                tipoMembresia = "💼 Seller / Vendedor";
                fechaActivacion = "∞";
                fechaExpiracion = "∞";
            } else if (row && row.acceso) {
                if (row.fecha_activacion) {
                    fechaActivacion = new Date(row.fecha_activacion).toLocaleDateString('es-CO');
                }
                if (row.acceso === 'perm') {
                    tipoMembresia = "💎 VIP Permanente";
                    fechaExpiracion = "∞ Permanente";
                } else if (new Date(row.acceso) > new Date()) {
                    tipoMembresia = "⏱️ VIP Activo";
                    fechaExpiracion = new Date(row.acceso).toLocaleDateString('es-CO');
                } else {
                    tipoMembresia = "❌ Membresía Expirada";
                    fechaExpiracion = new Date(row.acceso).toLocaleDateString('es-CO') + " (Expirado)";
                }
            }
        } catch (e) {
            tipoMembresia = "⚠️ Error";
        }
    }

    let perfil = `╔════════════════════════════╗\n`;
    perfil += `       👤 <b>MI PERFIL</b>\n`;
    perfil += `╚════════════════════════════╝\n\n`;
    perfil += `🆔 <b>ID:</b> <code>${userId}</code>\n`;
    perfil += `👤 <b>Username:</b> ${username}\n`;
    perfil += `📝 <b>Nombre:</b> <code>${nombre}</code>\n`;
    perfil += `🏅 <b>Membresía:</b> <b>${tipoMembresia}</b>\n`;
    perfil += `📅 <b>Activado:</b> <code>${fechaActivacion}</code>\n`;
    perfil += `⏳ <b>Expira:</b> <code>${fechaExpiracion}</code>\n`;
    perfil += `───────────────────────────────\n`;
    perfil += `✨ <b>by @El_CuervoX & @DarkNull1</b>`;

    ctx.reply(perfil, { parse_mode: 'HTML' });
});

bot.command('comprar', (ctx) => {
    let msg = `╔════════════════════════════╗\n`;
    msg += `       💳 <b>COMPRAR ACCESO</b>\n`;
    msg += `╚════════════════════════════╝\n\n`;
    msg += `💰 <b>Precios:</b>\n`;
    msg += ` ├ ⏱️ <b>7 días:</b> $5.000 COP\n`;
    msg += ` ├ ⏱️ <b>15 días:</b> $8.000 COP\n`;
    msg += ` ├ ⏱️ <b>30 días:</b> $12.000 COP\n`;
    msg += ` └ 💎 <b>Permanente:</b> $25.000 COP\n\n`;
    msg += `📱 <b>Nequi:</b> <code>3233406564</code>\n\n`;
    msg += `📲 <b>Envía el comprobante a:</b>\n`;
    msg += ` ├ 👑 @El_CuervoX\n`;
    msg += ` └ 👑 @DarkNull1\n\n`;
    msg += `⚡ <b>¡Tu acceso se activa al instante!</b>\n`;
    msg += `───────────────────────────────\n`;
    msg += `✨ <b>by @El_CuervoX & @DarkNull1</b>`;

    ctx.reply(msg, { parse_mode: 'HTML' });
});

bot.command('recargar', (ctx) => {
    let msg = `╔════════════════════════════╗\n`;
    msg += `       🔄 <b>RECARGAR CUENTA</b>\n`;
    msg += `╚════════════════════════════╝\n\n`;
    msg += `💳 <b>Pagos aceptados:</b>\n\n`;
    msg += `📱 <b>Nequi:</b> <code>3233406564</code>\n\n`;
    msg += `📲 <b>Envía tu comprobante a:</b>\n`;
    msg += ` ├ 👑 @El_CuervoX\n`;
    msg += ` └ 👑 @DarkNull1\n\n`;
    msg += `📝 <b>Incluye tu ID:</b> <code>${ctx.from.id}</code>\n\n`;
    msg += `⚡ <b>Se confirma en menos de 5 min</b>\n`;
    msg += `───────────────────────────────\n`;
    msg += `✨ <b>by @El_CuervoX & @DarkNull1</b>`;

    ctx.reply(msg, { parse_mode: 'HTML' });
});

bot.command('nequi', async (ctx) => {
    const accesoAutorizado = await verificarAcceso(ctx);
    if (!accesoAutorizado) return;
    esperandoNumero[ctx.from.id] = true;
    ctx.reply("📱 Envía el número a consultar:");
});

bot.command('panel', async (ctx) => {
    const userId = ctx.from.id;
    const esOwner = OWNER_IDS.includes(userId);
    
    // Query combinada optimizada
    const result = await pool.query(
        `SELECT (SELECT 1 FROM sellers WHERE seller_id = $1) as es_seller`,
        [userId]
    );
    const esSeller = result.rows[0]?.es_seller;

    if (!esSeller && !esOwner) return enviarStart(ctx);

    let menu = `╔════════════════════════╗\n⚙️   <b>PANEL DE CONTROL</b> \n╚════════════════════════╝\n\n`;
    if (esOwner) {
        menu += `👑 <b>RANGO:</b> <code>Owner / Dueño</code>\n\n📝 <b>COMANDOS:</b>\n🔹 <code>/vender [ID] [Dias/perm]</code>\n🔹 <code>/lista</code>\n🔹 <code>/addseller [ID]</code>\n🔹 <code>/delseller [ID]</code>\n`;
    } else {
        menu += `💼 <b>RANGO:</b> <code>Seller Autorizado</code>\n\n📝 <b>COMANDOS:</b>\n🔹 <code>/vender [ID] [Dias/perm]</code>\n🔹 <code>/lista</code>\n`;
    }
    menu += `─────────────────────────\n✨ <b>by : @El_CuervoX</b>`;
    ctx.reply(menu, { parse_mode: 'HTML' });
});

bot.command('lista', async (ctx) => {
    const userId = ctx.from.id;
    const esOwner = OWNER_IDS.includes(userId);
    
    // Query combinada optimizada
    const result = await pool.query(
        `SELECT (SELECT 1 FROM sellers WHERE seller_id = $1) as es_seller`,
        [userId]
    );
    const esSeller = result.rows[0]?.es_seller;

    if (!esSeller && !esOwner) return; 

    // Una sola query para todo
    const [listaSellers, listaVips] = await Promise.all([
        pool.query('SELECT seller_id FROM sellers'),
        pool.query('SELECT cliente_id, acceso FROM vips')
    ]);

    let output = `╔════════════════════════╗\n📋   <b>BASE DE DATOS ACTIVA</b> \n╚════════════════════════╝\n\n`;
    if (esOwner) {
        output += `💼 <b>VENDEDORES (${listaSellers.rowCount}):</b>\n`;
        listaSellers.rows.forEach(s => { output += ` ├ <code>${s.seller_id}</code>\n`; });
        output += `─────────────────────────\n\n`;
    }

    output += `💎 <b>VIPs (${listaVips.rowCount}):</b>\n`;
    listaVips.rows.forEach(v => {
        if (v.acceso === 'perm') {
            output += ` ├ 🆔 <code>${v.cliente_id}</code> ➔ <code>💎 Perm</code>\n`;
        } else {
            const expira = new Date(v.acceso);
            output += ` ├ 🆔 <code>${v.cliente_id}</code> ➔ <code>${expira > new Date() ? '⏱️ Activo' : '❌ Expirado'}</code>\n`;
        }
    });
    ctx.reply(output, { parse_mode: 'HTML' });
});

bot.command('addseller', async (ctx) => {
    if (!OWNER_IDS.includes(ctx.from.id)) return;
    const sId = parseInt(ctx.message.text.split(' ')[1]);
    if (!sId || isNaN(sId)) return ctx.reply("❌ Uso: /addseller [ID]");
    
    await pool.query('INSERT INTO sellers (seller_id) VALUES ($1) ON CONFLICT (seller_id) DO NOTHING', [sId]);
    ctx.reply(`✅ <code>${sId}</code> guardado como Seller.`, { parse_mode: 'HTML' });
});

bot.command('delseller', async (ctx) => {
    if (!OWNER_IDS.includes(ctx.from.id)) return;
    const sId = parseInt(ctx.message.text.split(' ')[1]);
    if (!sId || isNaN(sId)) return ctx.reply("❌ Uso: /delseller [ID]");
    
    await pool.query('DELETE FROM sellers WHERE seller_id = $1', [sId]);
    ctx.reply("🗑️ Seller revocado.");
});

bot.command('vender', async (ctx) => {
    const sellerId = ctx.from.id;
    const esOwner = OWNER_IDS.includes(sellerId);
    
    // Query optimizada
    if (!esOwner) {
        const result = await pool.query('SELECT 1 FROM sellers WHERE seller_id = $1', [sellerId]);
        if (!result.rowCount) return;
    }

    const args = ctx.message.text.split(' ');
    const clienteId = parseInt(args[1]);
    const tiempo = args[2];

    if (!clienteId || isNaN(clienteId) || !tiempo) return ctx.reply("❌ Uso: /vender [ID] [Dias/perm]");

    let stringAcceso = 'perm';
    if (tiempo.toLowerCase() !== 'perm') {
        let l = new Date();
        l.setDate(l.getDate() + parseInt(tiempo));
        stringAcceso = l.toISOString();
    }

    await pool.query(`
        INSERT INTO vips (cliente_id, acceso, fecha_activacion) VALUES ($1, $2, NOW())
        ON CONFLICT (cliente_id) DO UPDATE SET acceso = EXCLUDED.acceso, fecha_activacion = NOW()
    `, [clienteId, stringAcceso]);

    ctx.reply(`✅ <b>Venta guardada en Base de Datos!</b>`, { parse_mode: 'HTML' });
    bot.telegram.sendMessage(clienteId, `🎉 <b>Acceso activado!</b> Presiona /nequi`, { parse_mode: 'HTML' }).catch(()=>{});
});

bot.on('text', async (ctx) => {
    const userId = ctx.from.id;
    if (!esperandoNumero[userId]) return;
    delete esperandoNumero[userId];

    const numero = ctx.message.text.trim();
    if (isNaN(numero) || numero.length < 7) return ctx.reply("❌ Número inválido.");

    const accesoAutorizado = await verificarAcceso(ctx);
    if (!accesoAutorizado) return;

    // Verificar caché optimizado
    const cached = getCache(cacheConsultas, numero);
    if (cached) {
        let r = `📱 <b>Celular:</b> <code>${numero}</code> (Caché)\n\n`;
        for (const [k, v] of Object.entries(cached)) { r += `🔹 <b>${k.toUpperCase()}:</b> <code>${v}</code>\n`; }
        return ctx.reply(r, { parse_mode: 'HTML' });
    }

    const msg = await ctx.reply("⏳ <b>Iniciando consulta... [░░░░░░░░░░] 0%</b>", { parse_mode: 'HTML' });
    
    try {
        // Mover progreso más rápido
        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, "⚡ <b>Buscando... [██████░░░░] 60%</b>", { parse_mode: 'HTML' }).catch(()=>{});
        
        const res = await axios.get(`https://cuervo-api.vercel.app/nequi/${numero}?key=ohhyejin1`, { timeout: 10000 });
        const data = res.data;

        if (data.error) {
            await ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id).catch(()=>{});
            return ctx.reply(`⚠️ Error: ${data.error}`);
        }

        // Guardar en caché con TTL
        setCache(cacheConsultas, numero, data, CACHE_TTL_CONSULTA);
        
        let r = `👁️ <b>EL OJO DE DIOS</b>\n\n📱 <b>Celular:</b> <code>${numero}</code>\n\n`;
        for (const [k, v] of Object.entries(data)) {
            if (k==='eps' || k==='tiempo') continue;
            r += `🔹 <b>${k.toUpperCase()}:</b> <code>${v}</code>\n`;
        }
        
        await ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id).catch(()=>{});
        ctx.reply(r, { parse_mode: 'HTML' });
    } catch (e) {
        await ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id).catch(()=>{});
        ctx.reply("❌ Error al conectar.");
    }
});

// --- CONFIGURACIÓN DE PUERTO (EXPRESS) ---
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('Bot Activo');
});

app.listen(PORT, () => {
    console.log(`🤖 Servidor local corriendo en el puerto ${PORT}`);
    
    // Lanzar bot de forma segura
    bot.launch()
        .then(() => console.log("🚀 Bot de Telegram iniciado correctamente."))
        .catch((err) => {
            console.error("❌ Error en Telegraf. Revisa el Token:", err.message);
        });
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));