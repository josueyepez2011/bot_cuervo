const { Telegraf } = require('telegraf');
const axios = require('axios');
const { Pool } = require('pg');
const express = require('express');

// Token oficial NUEVO y actualizado
const bot = new Telegraf('8664870579:AAH-H8QYIA5qIA5z4HfszktMNI9viBDj08E'); 

// ID del Dueño Absoluto
const OWNER_ID = 7703974919;

// Enlace oficial de tu base de datos PostgreSQL en Render
const POSTGRES_URL = "postgresql://cuervo:0EeaYwdcpetEi110JkCEbKaxibckNAp4@dpg-d999nn8k1i2s73dsr5ug-a.oregon-postgres.render.com/ojodios";

// Configuración de la conexión a PostgreSQL
const pool = new Pool({
    connectionString: POSTGRES_URL,
    ssl: { rejectUnauthorized: false } // Requerido para conectar de forma segura
});

// Control de estados en memoria (temporal por consulta)
const esperandoNumero = {};
const cacheConsultas = {}; 

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
                acceso TEXT
            );
        `);
        console.log("📦 PostgreSQL listo y tablas verificadas con éxito.");
    } catch (err) {
        console.error("❌ Error al inicializar tablas en Postgres:", err);
    }
}
iniciarBD();

// --- VALIDAR ACCESOS ---
async function verificarAcceso(ctx) {
    const userId = ctx.from.id;
    if (userId === OWNER_ID) return true;

    try {
        const esSeller = await pool.query('SELECT 1 FROM sellers WHERE seller_id = $1', [userId]);
        if (esSeller.rowCount > 0) return true;

        const vipRes = await pool.query('SELECT acceso FROM vips WHERE cliente_id = $1', [userId]);
        if (vipRes.rowCount === 0) {
            ctx.reply("❌ No tienes acceso, compra tu acceso con @El_CuervoX");
            return false;
        }

        const acceso = vipRes.rows[0].acceso;
        if (acceso === 'perm') return true;

        if (new Date(acceso) > new Date()) {
            return true;
        } else {
            ctx.reply("❌ RENUEVA TU ACCESO CON @El_CuervoX");
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

    if (userId === OWNER_ID) {
        tipoMembresia = "👑 Owner / Creador";
    } else {
        try {
            const esSeller = await pool.query('SELECT 1 FROM sellers WHERE seller_id = $1', [userId]);
            if (esSeller.rowCount > 0) {
                tipoMembresia = "💼 Seller / Vendedor Autorizado";
            } else {
                const vipRes = await pool.query('SELECT acceso FROM vips WHERE cliente_id = $1', [userId]);
                if (vipRes.rowCount > 0) {
                    const acceso = vipRes.rows[0].acceso;
                    if (acceso === 'perm') {
                        tipoMembresia = "💎 VIP Permanente";
                    } else if (new Date(acceso) > new Date()) {
                        const fechaFormat = new Date(acceso).toISOString().split('T')[0];
                        tipoMembresia = `⏱️ VIP Activo (Vence: ${fechaFormat})`;
                    } else {
                        tipoMembresia = "❌ Membresía Expirada";
                    }
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
    bienvenidaPanel += `✨ <b>by : @El_CuervoX</b>`;

    ctx.reply(bienvenidaPanel, { parse_mode: 'HTML' });
}

bot.start((ctx) => { enviarStart(ctx); });

bot.command('nequi', async (ctx) => {
    const accesoAutorizado = await verificarAcceso(ctx);
    if (!accesoAutorizado) return;
    esperandoNumero[ctx.from.id] = true;
    ctx.reply("📱 Envía el número a consultar:");
});

bot.command('panel', async (ctx) => {
    const userId = ctx.from.id;
    const esSeller = await pool.query('SELECT 1 FROM sellers WHERE seller_id = $1', [userId]);
    const esOwner = userId === OWNER_ID;

    if (esSeller.rowCount === 0 && !esOwner) return enviarStart(ctx);

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
    const esSeller = await pool.query('SELECT 1 FROM sellers WHERE seller_id = $1', [userId]);
    const esOwner = userId === OWNER_ID;

    if (esSeller.rowCount === 0 && !esOwner) return; 

    const listaSellers = await pool.query('SELECT seller_id FROM sellers');
    const listaVips = await pool.query('SELECT cliente_id, acceso FROM vips');

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
    if (ctx.from.id !== OWNER_ID) return;
    const sId = parseInt(ctx.message.text.split(' ')[1]);
    if (!sId || isNaN(sId)) return ctx.reply("❌ Uso: /addseller [ID]");
    
    await pool.query('INSERT INTO sellers (seller_id) VALUES ($1) ON CONFLICT (seller_id) DO NOTHING', [sId]);
    ctx.reply(`✅ <code>${sId}</code> guardado como Seller.`, { parse_mode: 'HTML' });
});

bot.command('delseller', async (ctx) => {
    if (ctx.from.id !== OWNER_ID) return;
    const sId = parseInt(ctx.message.text.split(' ')[1]);
    if (!sId || isNaN(sId)) return ctx.reply("❌ Uso: /delseller [ID]");
    
    await pool.query('DELETE FROM sellers WHERE seller_id = $1', [sId]);
    ctx.reply("🗑️ Seller revocado.");
});

bot.command('vender', async (ctx) => {
    const sellerId = ctx.from.id;
    const esSeller = await pool.query('SELECT 1 FROM sellers WHERE seller_id = $1', [sellerId]);
    const esOwner = sellerId === OWNER_ID;
    if (esSeller.rowCount === 0 && !esOwner) return; 

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
        INSERT INTO vips (cliente_id, acceso) VALUES ($1, $2)
        ON CONFLICT (cliente_id) DO UPDATE SET acceso = EXCLUDED.acceso
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

    if (cacheConsultas[numero]) {
        const d = cacheConsultas[numero];
        let r = `📱 <b>Celular:</b> <code>${numero}</code> (Caché)\n\n`;
        for (const [k, v] of Object.entries(d)) { r += `🔹 <b>${k.toUpperCase()}:</b> <code>${v}</code>\n`; }
        return ctx.reply(r, { parse_mode: 'HTML' });
    }

    const msg = await ctx.reply("⏳ <b>Iniciando consulta... [░░░░░░░░░░] 0%</b>", { parse_mode: 'HTML' });
    const delay = (ms) => new Promise(res => setTimeout(res, ms));
    
    try {
        await delay(300);
        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, "⚡ <b>Buscando... [██████░░░░] 60%</b>", { parse_mode: 'HTML' }).catch(()=>{});
        
        const res = await axios.get(`https://lsdarkapi.pages.dev/api/v1/nequi/consulta?numero=${numero}`, {
            headers: {
                'X-API-key': 'ohhyejin1'
            }
        });
        const data = res.data;

        if (data.error) {
            await ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id).catch(()=>{});
            return ctx.reply(`⚠️ Error: ${data.error}`);
        }

        cacheConsultas[numero] = data;
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