const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const { Pool } = require('pg');
const express = require('express');

// Token oficial NUEVO y actualizado
const bot = new Telegraf('8664870579:AAH-H8QYIA5qIA5z4HfszktMNI9viBDj08E'); 

// IDs de los Dueños Absolutos
const OWNER_IDS = [7703974919, 8116120039];

// Enlace oficial de tu base de datos PostgreSQL en Render
const POSTGRES_URL = "postgresql://cuervo:0EeaYwdcpetEi110JkCEbKaxibckNAp4@dpg-d999nn8k1i2s73dsr5ug-a.oregon-postgres.render.com/ojodios";

// Configuración de la conexión a PostgreSQL
const pool = new Pool({
    connectionString: POSTGRES_URL,
    ssl: { rejectUnauthorized: false } // Requerido para conectar de forma segura
});

// Control de estados en memoria (temporal por consulta)
const esperandoNumero = {};
const esperandoValorKey = {};
const esperandoActivarKey = {};
const esperandoNombreKey = {};
const esperandoRecargarMonto = {};
const esperandoTiempoKey = {};
const confirmandoEliminarKey = {};
const esperandoGenkeyDias = {};
const esperandoDelkeyKey = {};
const esperandoVenderkeyTiempo = {};
const esperandoDelateKey = {};
const keyActiva = {};

function generarKey(tipo) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const longitud = tipo === 'master' ? 10 : 15;
    let key = tipo === 'master' ? 'MK-' : 'UK-';
    for (let i = 0; i < longitud; i++) {
        if (i > 0 && i % 5 === 0) key += '-';
        key += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return key;
}

function fechaColombia() {
    return new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });
}

function fechaColombiaISO() {
    return new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Bogota' });
}

function fechaVencimiento(dias) {
    const f = new Date();
    f.setDate(f.getDate() + dias);
    return f.toLocaleDateString('sv-SE', { timeZone: 'America/Bogota' });
}

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
        // Tabla de Keys Maestras (Owners)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS master_keys (
                id SERIAL PRIMARY KEY,
                key TEXT UNIQUE NOT NULL,
                balance BIGINT DEFAULT 0,
                owner_id BIGINT NOT NULL,
                created_at TIMESTAMP DEFAULT NOW()
            );
        `);
        await pool.query(`ALTER TABLE master_keys ADD COLUMN IF NOT EXISTS user_id BIGINT`);
        await pool.query(`ALTER TABLE master_keys ADD COLUMN IF NOT EXISTS nombre TEXT`);
        // Tabla de Keys de Usuarios
        await pool.query(`
            CREATE TABLE IF NOT EXISTS user_keys (
                id SERIAL PRIMARY KEY,
                key TEXT UNIQUE NOT NULL,
                nombre TEXT,
                vencimiento TEXT,
                owner_key TEXT,
                user_id BIGINT,
                activa BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT NOW()
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
    if (userId === OWNER_IDS[0] || userId === OWNER_IDS[1]) return true;

    try {
        const result = await pool.query(`
            SELECT 
                (SELECT 1 FROM sellers WHERE seller_id = $1) as es_seller,
                (SELECT acceso FROM vips WHERE cliente_id = $1) as vip_acceso,
                (SELECT vencimiento FROM user_keys WHERE user_id = $1) as user_key_vencimiento,
                (SELECT 1 FROM master_keys WHERE user_id = $1) as es_master
        `, [userId]);

        const row = result.rows[0];

        if (row.es_seller) return true;

        if (row.vip_acceso) {
            if (row.vip_acceso === 'perm') return true;
            if (new Date(row.vip_acceso) > new Date()) return true;
        }

        if (row.user_key_vencimiento) {
            if (new Date(row.user_key_vencimiento) < new Date()) {
                await pool.query('UPDATE user_keys SET user_id = NULL WHERE user_id = $1', [userId]);
                ctx.reply("❌ Tu key ha expirado. Compra una nueva con @DarkNull1 | @El_CuervoX");
                return false;
            }
            return true;
        }

        if (row.es_master) return true;

        ctx.reply("❌ No tienes acceso, compra tu acceso con @DarkNull1 | @El_CuervoX");
        return false;
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
    let tieneAcceso = false;

    if (userId === OWNER_IDS[0] || userId === OWNER_IDS[1]) {
        tipoMembresia = "👑 Owner / Creador";
        tieneAcceso = true;
    } else {
        try {
            const esSeller = await pool.query('SELECT 1 FROM sellers WHERE seller_id = $1', [userId]);
            if (esSeller.rowCount > 0) {
                tipoMembresia = "💼 Seller / Vendedor Autorizado";
                tieneAcceso = true;
            } else {
                const vipRes = await pool.query('SELECT acceso FROM vips WHERE cliente_id = $1', [userId]);
                if (vipRes.rowCount > 0) {
                    const acceso = vipRes.rows[0].acceso;
                    if (acceso === 'perm') {
                        tipoMembresia = "💎 VIP Permanente";
                        tieneAcceso = true;
                    } else if (new Date(acceso) > new Date()) {
                        const fechaFormat = fechaColombiaISO();
                        tipoMembresia = `⏱️ VIP Activo (Vence: ${fechaFormat})`;
                        tieneAcceso = true;
                    } else {
                        tipoMembresia = "❌ Membresía Expirada";
                    }
                }

                if (!tieneAcceso) {
                    const userKeyRes = await pool.query('SELECT vencimiento FROM user_keys WHERE user_id = $1', [userId]);
                    if (userKeyRes.rowCount > 0) {
                        const vencimiento = userKeyRes.rows[0].vencimiento;
                        if (!vencimiento || new Date(vencimiento) > new Date()) {
                            tipoMembresia = vencimiento ? `🔑 Key Activa (Vence: ${vencimiento})` : "🔑 Key Activa";
                            tieneAcceso = true;
                        }
                    }
                }

                if (!tieneAcceso) {
                    const masterRes = await pool.query('SELECT nombre FROM master_keys WHERE user_id = $1', [userId]);
                    if (masterRes.rowCount > 0) {
                        tipoMembresia = "🔑 Key Maestra";
                        tieneAcceso = true;
                    }
                }
            }
        } catch (e) {
            tipoMembresia = "⚠️ Error de lectura";
        }
    }

    let bienvenidaPanel = `👁️ <b>¡Bienvenido al Ojo de Dios!</b> \n`;
    bienvenidaPanel += `Para realizar una consulta presiona el comando /menu\n\n`;
    bienvenidaPanel += `╔════════════════════════╗\n`;
    bienvenidaPanel += `   👤   <b>MI PERFIL DE ACCESO</b> \n`;
    bienvenidaPanel += `╚════════════════════════╝\n\n`;
    bienvenidaPanel += `🆔 <b>Tu ID:</b> <code>${userId}</code>\n`;
    bienvenidaPanel += `👤 <b>Usuario:</b> ${username}\n`;
    bienvenidaPanel += `📝 <b>Nombre:</b> <code>${nombreCompleto}</code>\n`; 
    bienvenidaPanel += `🏅 <b>Membresía:</b> <b>${tipoMembresia}</b>\n`;
    bienvenidaPanel += `─────────────────────────\n`;
    bienvenidaPanel += `✨ <b>by @DarkNull1 | @El_CuervoX</b>`;

    if (tieneAcceso) {
        ctx.reply(bienvenidaPanel, { parse_mode: 'HTML' });
    } else {
        ctx.reply(bienvenidaPanel, {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('🔑 Activar Key', 'activar_key')],
                [Markup.button.callback('❌ Ignorar', 'ignorar')]
            ])
        });
    }
}

bot.start((ctx) => { enviarStart(ctx); });

bot.action('activar_key', async (ctx) => {
    await ctx.answerCbQuery();
    esperandoActivarKey[ctx.from.id] = true;
    await ctx.editMessageText("🔑 Por favor, ingresa tu key:", { parse_mode: 'HTML' });
});

bot.action('ignorar', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.deleteMessage();
});

bot.command('nequi', async (ctx) => {
    const accesoAutorizado = await verificarAcceso(ctx);
    if (!accesoAutorizado) return;
    esperandoNumero[ctx.from.id] = true;
    ctx.reply("📱 Envía el número a consultar:");
});

bot.command('panel', async (ctx) => {
    const userId = ctx.from.id;
    const esSeller = await pool.query('SELECT 1 FROM sellers WHERE seller_id = $1', [userId]);
    const esOwner = userId === OWNER_IDS[0] || userId === OWNER_IDS[1];

    if (esSeller.rowCount === 0 && !esOwner) return enviarStart(ctx);

    let menu = `╔════════════════════════╗\n⚙️   <b>PANEL DE CONTROL</b> \n╚════════════════════════╝\n\n`;
    if (esOwner) {
        menu += `👑 <b>RANGO:</b> <code>Owner / Dueño</code>\n\n🔑 <b>KEYS:</b>\n🔹 <code>/key</code> - Crear key maestra\n🔹 <code>/genkey [KEY] [Días]</code> - Generar key usuario\n🔹 <code>/verkeys</code> - Ver keys maestras\n🔹 <code>/veruserkeys</code> - Ver keys usuarios\n🔹 <code>/delkey [KEY]</code> - Eliminar key\n🔹 <code>/delallkeys</code> - Eliminar TODAS las keys\n💰 <code>/recargasaldo</code> - Recargar balance a key\n`;
    } else {
        menu += `💼 <b>RANGO:</b> <code>Seller Autorizado</code>\n\n🔑 <b>KEYS:</b>\n🔹 <code>/activarkey</code> - Activar key\n`;
    }
    menu += `─────────────────────────\n✨ <b>by @DarkNull1 | @El_CuervoX</b>`;

    const buttons = [];
    if (esOwner) {
        buttons.push([Markup.button.callback('🔑 /key - Crear key maestra', 'panel_key')]);
        buttons.push([Markup.button.callback('🔑 /genkey [KEY] [Días]', 'panel_genkey')]);
        buttons.push([Markup.button.callback('📋 /verkeys', 'panel_verkeys')]);
        buttons.push([Markup.button.callback('👥 /veruserkeys', 'panel_veruserkeys')]);
        buttons.push([Markup.button.callback('❌ /delkey [KEY]', 'panel_delkey')]);
        buttons.push([Markup.button.callback('🗑️ /delallkeys', 'panel_delallkeys')]);
        buttons.push([Markup.button.callback('💰 /recargasaldo', 'panel_recargasaldo')]);
        buttons.push([Markup.button.callback('📢 Notificaciones', 'panel_notificaciones')]);
    } else {
        buttons.push([Markup.button.callback('🔑 /activarkey', 'panel_activarkey')]);
    }

    ctx.reply(menu, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(buttons)
    });
});

bot.action(/^panel_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const cmd = ctx.match[1];
    const userId = ctx.from.id;
    const esOwner = userId === OWNER_IDS[0] || userId === OWNER_IDS[1];

    switch (cmd) {
        case 'key':
            if (!esOwner) return;
            esperandoValorKey[userId] = true;
            ctx.reply("💰 Ingresa el valor de la cuenta (ejemplo: 100000):");
            break;
        case 'genkey':
            if (!esOwner) return;
            esperandoGenkeyDias[userId] = true;
            ctx.reply("⏱️ Por favor selecciona los días:\n\n• 1 Dia\n• 7 Dias\n• 30Dias\n• perm (permanente)\n\nResponde con el número o 'perm':");
            break;
        case 'verkeys':
            if (!esOwner) return;
            const vk = await pool.query('SELECT * FROM master_keys WHERE owner_id = $1', [userId]);
            if (vk.rowCount === 0) return ctx.reply("❌ No tienes keys creadas.");
            let outVk = `╔════════════════════════╗\n🔑 <b>KEYS MAESTRAS</b>\n╚════════════════════════╝\n\n`;
            vk.rows.forEach(k => {
                outVk += `├ <code>${k.key}</code>\n`;
                outVk += `│ 💰 Balance: $${k.balance.toLocaleString()}\n`;
                outVk += `│ 📅 ${new Date(k.created_at).toLocaleDateString('es-CO', { timeZone: 'America/Bogota' })}\n\n`;
            });
            outVk += `─────────────────────────\n✨ <b>by @DarkNull1 | @El_CuervoX</b>`;
            ctx.reply(outVk, { parse_mode: 'HTML' });
            break;
        case 'veruserkeys':
            if (!esOwner) return;
            const vuk = await pool.query('SELECT * FROM user_keys WHERE owner_key IN (SELECT key FROM master_keys WHERE owner_id = $1)', [userId]);
            if (vuk.rowCount === 0) return ctx.reply("❌ No hay keys de usuarios.");
            let outVuk = `╔════════════════════════╗\n👥 <b>KEYS DE USUARIOS</b>\n╚════════════════════════╝\n\n`;
            vuk.rows.forEach(k => {
                const estado = k.activa ? '✅' : '❌';
                const vence = k.vencimiento || 'Sin fecha';
                outVuk += `${estado} <code>${k.key}</code>\n`;
                outVuk += `│ 👤 ${k.nombre || 'Sin nombre'}\n`;
                outVuk += `│ 📅 Vence: ${vence}\n\n`;
            });
            outVuk += `─────────────────────────\n✨ <b>by @DarkNull1 | @El_CuervoX</b>`;
            ctx.reply(outVuk, { parse_mode: 'HTML' });
            break;
        case 'delkey':
            if (!esOwner) return;
            esperandoDelkeyKey[userId] = true;
            ctx.reply("❓ Ingresa la key que deseas eliminar:");
            break;
        case 'delallkeys':
            if (!esOwner) return;
            await pool.query('DELETE FROM user_keys');
            await pool.query('DELETE FROM master_keys');
            ctx.reply("🗑️ Todas las keys han sido eliminadas.");
            break;
        case 'recargasaldo':
            if (!esOwner) return;
            esperandoRecargarMonto[userId] = true;
            ctx.reply("💰 Ingresa la key maestra a recargar:");
            break;
        case 'activarkey':
            esperandoActivarKey[userId] = true;
            ctx.reply("🔑 Pega tu key:");
            break;
        case 'notificaciones':
            if (!esOwner) return;
            const notis = await pool.query('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 20');
            if (notis.rowCount === 0) return ctx.reply("📭 No hay notificaciones.");
            let outNotis = `╔════════════════════════╗\n📢 <b>NOTIFICACIONES</b>\n╚════════════════════════╝\n\n`;
            notis.rows.forEach((n, i) => {
                const fecha = new Date(n.created_at).toLocaleString('es-CO', { timeZone: 'America/Bogota' });
                outNotis += `#${i + 1} 📅 ${fecha}\n${n.mensaje}\n\n`;
            });
            outNotis += `─────────────────────────\n✨ <b>by @DarkNull1 | @El_CuervoX</b>`;
            ctx.reply(outNotis, {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('🗑️ Eliminar todas', 'eliminar_notificaciones')]
                ])
            });
            break;
    }
});

bot.command('lista', async (ctx) => {
    const userId = ctx.from.id;
    const esSeller = await pool.query('SELECT 1 FROM sellers WHERE seller_id = $1', [userId]);
    const esOwner = userId === OWNER_IDS[0] || userId === OWNER_IDS[1];

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
    if (ctx.from.id !== OWNER_IDS[0] && ctx.from.id !== OWNER_IDS[1]) return;
    const sId = parseInt(ctx.message.text.split(' ')[1]);
    if (!sId || isNaN(sId)) return ctx.reply("❌ Uso: /addseller [ID]");
    
    await pool.query('INSERT INTO sellers (seller_id) VALUES ($1) ON CONFLICT (seller_id) DO NOTHING', [sId]);
    ctx.reply(`✅ <code>${sId}</code> guardado como Seller.`, { parse_mode: 'HTML' });
});

bot.command('delseller', async (ctx) => {
    if (ctx.from.id !== OWNER_IDS[0] && ctx.from.id !== OWNER_IDS[1]) return;
    const sId = parseInt(ctx.message.text.split(' ')[1]);
    if (!sId || isNaN(sId)) return ctx.reply("❌ Uso: /delseller [ID]");
    
    await pool.query('DELETE FROM sellers WHERE seller_id = $1', [sId]);
    ctx.reply("🗑️ Seller revocado.");
});

bot.command('vender', async (ctx) => {
    const sellerId = ctx.from.id;
    const esSeller = await pool.query('SELECT 1 FROM sellers WHERE seller_id = $1', [sellerId]);
    const esOwner = sellerId === OWNER_IDS[0] || sellerId === OWNER_IDS[1];
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

// --- SISTEMA DE KEYS ---
bot.command('key', async (ctx) => {
    if (ctx.from.id !== OWNER_IDS[0] && ctx.from.id !== OWNER_IDS[1]) return;
    esperandoValorKey[ctx.from.id] = true;
    ctx.reply("💰 Ingresa el valor de la cuenta (ejemplo: 100000):");
});

bot.command('activarkey', async (ctx) => {
    const args = ctx.message.text.split(' ');
    const keyIngresada = args[1];
    
    if (keyIngresada) {
        const keyData = await pool.query('SELECT * FROM user_keys WHERE key = $1 AND activa = true', [keyIngresada]);
        if (keyData.rowCount > 0) {
            const key = keyData.rows[0];
            if (key.vencimiento && new Date(key.vencimiento) < new Date()) {
                return ctx.reply("❌ Key expirada.");
            }
            if (key.user_id) return ctx.reply("❌ Esta key ya fue activada.");
            await pool.query('UPDATE master_keys SET user_id = NULL, nombre = NULL WHERE user_id = $1', [ctx.from.id]);
            await pool.query('UPDATE user_keys SET user_id = $1 WHERE key = $2', [ctx.from.id, keyIngresada]);
            ctx.reply("✅ Key activada!\nUsa /nequi para consultar.");
            return;
        }
        
        const masterData = await pool.query('SELECT * FROM master_keys WHERE key = $1', [keyIngresada]);
        if (masterData.rowCount > 0) {
            if (masterData.rows[0].user_id) return ctx.reply("❌ Esta key ya fue activada.");
            keyActiva[ctx.from.id] = { key: keyIngresada, tipo: 'master' };
            esperandoNombreKey[ctx.from.id] = true;
            ctx.reply("📝 Ingresa tu nombre:");
            return;
        }
        
        return ctx.reply("❌ Key no encontrada.");
    }
    
    esperandoActivarKey[ctx.from.id] = true;
    ctx.reply("🔑 Pega tu key:");
});

bot.command('verkeys', async (ctx) => {
    if (ctx.from.id !== OWNER_IDS[0] && ctx.from.id !== OWNER_IDS[1]) return;
    
    const keys = await pool.query('SELECT * FROM master_keys WHERE owner_id = $1', [ctx.from.id]);
    if (keys.rowCount === 0) return ctx.reply("❌ No tienes keys creadas.");
    
    let output = `╔════════════════════════╗\n🔑 <b>KEYS MAESTRAS</b>\n╚════════════════════════╝\n\n`;
    keys.rows.forEach(k => {
        output += `├ <code>${k.key}</code>\n`;
        output += `│ 💰 Balance: $${k.balance.toLocaleString()}\n`;
        output += `│ 📅 ${new Date(k.created_at).toLocaleDateString('es-CO', { timeZone: 'America/Bogota' })}\n\n`;
    });
    output += `─────────────────────────\n✨ <b>by @DarkNull1 | @El_CuervoX</b>`;
    ctx.reply(output, { parse_mode: 'HTML' });
});

bot.command('veruserkeys', async (ctx) => {
    if (ctx.from.id !== OWNER_IDS[0] && ctx.from.id !== OWNER_IDS[1]) return;
    
    const keys = await pool.query('SELECT * FROM user_keys WHERE owner_key IN (SELECT key FROM master_keys WHERE owner_id = $1)', [ctx.from.id]);
    if (keys.rowCount === 0) return ctx.reply("❌ No hay keys de usuarios.");
    
    let output = `╔════════════════════════╗\n👥 <b>KEYS DE USUARIOS</b>\n╚════════════════════════╝\n\n`;
    keys.rows.forEach(k => {
        const estado = k.activa ? '✅' : '❌';
        const vence = k.vencimiento || 'Sin fecha';
        output += `${estado} <code>${k.key}</code>\n`;
        output += `│ 👤 ${k.nombre || 'Sin nombre'}\n`;
        output += `│ 📅 Vence: ${vence}\n\n`;
    });
    output += `─────────────────────────\n✨ <b>by @DarkNull1 | @El_CuervoX</b>`;
    ctx.reply(output, { parse_mode: 'HTML' });
});

bot.command('delkey', async (ctx) => {
    if (ctx.from.id !== OWNER_IDS[0] && ctx.from.id !== OWNER_IDS[1]) return;
    const args = ctx.message.text.split(' ');
    const keyToDelete = args[1];
    if (!keyToDelete) return ctx.reply("❌ Uso: /delkey [KEY]");
    
    await pool.query('DELETE FROM user_keys WHERE key = $1', [keyToDelete]);
    await pool.query('DELETE FROM master_keys WHERE key = $1', [keyToDelete]);
    ctx.reply(`🗑️ Key <code>${keyToDelete}</code> eliminada.`, { parse_mode: 'HTML' });
});

bot.command('delallkeys', async (ctx) => {
    if (ctx.from.id !== OWNER_IDS[0] && ctx.from.id !== OWNER_IDS[1]) return;
    
    await pool.query('DELETE FROM user_keys');
    await pool.query('DELETE FROM master_keys');
    ctx.reply("🗑️ Todas las keys han sido eliminadas.");
});

bot.command('genkey', async (ctx) => {
    if (ctx.from.id !== OWNER_IDS[0] && ctx.from.id !== OWNER_IDS[1]) return;
    const args = ctx.message.text.split(' ');
    const masterKey = args[1];
    const dias = parseInt(args[2]) || 30;
    
    if (!masterKey) return ctx.reply("❌ Uso: /genkey [KEY_MAESTRA] [Días]");
    
    const master = await pool.query('SELECT * FROM master_keys WHERE key = $1 AND owner_id = $2', [masterKey, ctx.from.id]);
    if (master.rowCount === 0) return ctx.reply("❌ Key maestra no encontrada.");
    if (master.rows[0].balance < 1) return ctx.reply("❌ Sin balance en esta key.");
    
    const newKey = generarKey('user');
    const vence = fechaVencimiento(dias);
    
    await pool.query('INSERT INTO user_keys (key, vencimiento, owner_key) VALUES ($1, $2, $3)', [newKey, vence, masterKey]);
    await pool.query('UPDATE master_keys SET balance = balance - 1 WHERE key = $1', [masterKey]);
    
    ctx.reply(`✅ Key generada:\n<code>${newKey}</code>\n📅 Vence: ${vence}`, { parse_mode: 'HTML' });
});

bot.command('menu', async (ctx) => {
    const userId = ctx.from.id;
    
    const master = await pool.query('SELECT * FROM master_keys WHERE user_id = $1', [userId]);
    if (master.rowCount > 0) {
        const k = master.rows[0];
        let menu = `╔════════════════════════╗\n👤 <b>MI PERFIL</b>\n╚════════════════════════╝\n\n`;
        menu += `📝 <b>Nombre:</b> ${k.nombre || 'Sin nombre'}\n`;
        menu += `🔑 <b>Key:</b> <code>${k.key}</code>\n`;
        menu += `💰 <b>Balance:</b> $${k.balance.toLocaleString()} COP\n`;
        menu += `📅 <b>Creada:</b> ${new Date(k.created_at).toLocaleDateString('es-CO', { timeZone: 'America/Bogota' })}\n\n`;
        menu += `╔════════════════════════╗\n📝 <b>COMANDOS</b>\n╚════════════════════════╝\n\n`;
        menu += `🔹 <code>/nequi</code> - Consultar número\n`;
        menu += `🔹 <code>/venderkey [tiempo]</code> - Generar key\n`;
        menu += `🔹 <code>/miskeys</code> - Ver keys generadas\n`;
        menu += `🔹 <code>/preciokey</code> - Ver precios de venta\n`;
        menu += `🔹 <code>/recargar</code> - Recargar balance\n`;
        menu += `🔹 <code>/delate [KEY]</code> - Eliminar key\n\n`;
        menu += `💰 <b>Precios:</b>\n`;
        menu += `• 1 día → $10.000\n`;
        menu += `• 7 días → $20.000\n`;
        menu += `• 30 días → $70.000\n`;
        menu += `• Permanente → $200.000\n\n`;
        menu += `─────────────────────────\n✨ <b>by @DarkNull1 | @El_CuervoX</b>`;
        return ctx.reply(menu, {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('📱 /nequi', 'menu_nequi')],
                [Markup.button.callback('💎 /venderkey', 'menu_venderkey')],
                [Markup.button.callback('🔑 /miskeys', 'menu_miskeys')],
                [Markup.button.callback('💰 /preciokey', 'menu_preciokey')],
                [Markup.button.callback('🔄 /recargar', 'menu_recargar')],
                [Markup.button.callback('🗑️ /delate', 'menu_delate')]
            ])
        });
    }
    
    const userKey = await pool.query('SELECT * FROM user_keys WHERE user_id = $1', [userId]);
    if (userKey.rowCount > 0) {
        const k = userKey.rows[0];
        let menu = `╔════════════════════════╗\n👤 <b>MI PERFIL</b>\n╚════════════════════════╝\n\n`;
        menu += `🔑 <b>Key:</b> <code>${k.key}</code>\n`;
        menu += `📅 <b>Creada:</b> ${new Date(k.created_at).toLocaleDateString('es-CO', { timeZone: 'America/Bogota' })}\n\n`;
        menu += `📝 <b>COMANDOS:</b>\n🔹 <code>/nequi</code> - Consultar número\n`;
        menu += `─────────────────────────\n✨ <b>by @DarkNull1 | @El_CuervoX</b>`;
        return ctx.reply(menu, {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('📱 /nequi', 'menu_nequi')]
            ])
        });
    }
    
    enviarStart(ctx);
});

bot.action(/^menu_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const cmd = ctx.match[1];
    const userId = ctx.from.id;

    switch (cmd) {
        case 'nequi':
            const acceso = await verificarAcceso(ctx);
            if (!acceso) return;
            esperandoNumero[userId] = true;
            ctx.reply("📱 Envía el número a consultar:");
            break;
        case 'venderkey':
            esperandoVenderkeyTiempo[userId] = true;
            ctx.reply("⏱️ ¿Para cuántos días quieres generar la key?\n\nOpciones:\n• 1 → 1 día ($7.000)\n• 7 → 7 días ($15.000)\n• 30 → 30 días ($55.000)\n• perm → Permanente ($150.000)\n\n⚠️ Este valor se descuenta de tu balance.\n\nResponde con el número o 'perm':");
            break;
        case 'miskeys':
            const mm = await pool.query('SELECT key FROM master_keys WHERE user_id = $1', [userId]);
            if (mm.rowCount === 0) return ctx.reply("❌ No tienes key maestra activa.");
            const mk = await pool.query('SELECT * FROM user_keys WHERE owner_key = $1', [mm.rows[0].key]);
            if (mk.rowCount === 0) return ctx.reply("❌ No has generado keys aún.");
            let outMk = `╔════════════════════════╗\n👥 <b>MIS KEYS GENERADAS</b>\n╚════════════════════════╝\n\n`;
            const now = new Date();
            let hayExp = false;
            mk.rows.forEach(k => {
                const expirada = k.vencimiento && new Date(k.vencimiento) < now;
                const estado = expirada ? '❌ Expirada' : (k.user_id ? '✅ Usada' : '⏳ Disponible');
                if (expirada) hayExp = true;
                outMk += `├ <code>${k.key}</code>\n│ ${estado}\n│ 📅 Vence: ${k.vencimiento || 'Permanente'}\n\n`;
            });
            outMk += `─────────────────────────\n✨ <b>by @DarkNull1 | @El_CuervoX</b>`;
            if (hayExp) {
                ctx.reply(outMk, {
                    parse_mode: 'HTML',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback('🗑️ Eliminar keys expiradas', 'eliminar_keys_expiradas')],
                        [Markup.button.callback('🆕 Generar nueva key', 'generar_nueva_key')]
                    ])
                });
            } else {
                ctx.reply(outMk, { parse_mode: 'HTML' });
            }
            break;
        case 'preciokey':
            const mp = await pool.query('SELECT * FROM master_keys WHERE user_id = $1', [userId]);
            if (mp.rowCount === 0) return ctx.reply("❌ No tienes una key maestra activa.");
            let preMenu = `╔════════════════════════╗\n💰 <b>TUS PRECIOS DE VENTA</b>\n╚════════════════════════╝\n\n`;
            preMenu += `⏱️ <b>Opciones de key:</b>\n\n`;
            preMenu += `🔹 1 día → <b>$10.000</b>\n🔹 7 días → <b>$20.000</b>\n🔹 30 días → <b>$70.000</b>\n🔹 Permanente → <b>$200.000</b>\n\n`;
            preMenu += `💰 <b>Tu Balance:</b> $${mp.rows[0].balance.toLocaleString()} COP\n`;
            preMenu += `─────────────────────────\n✨ <b>by @DarkNull1 | @El_CuervoX</b>`;
            ctx.reply(preMenu, { parse_mode: 'HTML' });
            break;
        case 'recargar':
            const mr = await pool.query('SELECT * FROM master_keys WHERE user_id = $1', [userId]);
            if (mr.rowCount === 0) return ctx.reply("❌ No tienes una key maestra activa.");
            let recMenu = `╔════════════════════════╗\n💰 <b>SOLICITAR RECARGA</b>\n╚════════════════════════╝\n\n`;
            recMenu += `🔑 <b>Tu Key:</b> <code>${mr.rows[0].key}</code>\n`;
            recMenu += `💰 <b>Balance actual:</b> $${mr.rows[0].balance.toLocaleString()} COP\n\n`;
            recMenu += `📞 <b>Para recargar contacta a:</b>\n🔹 @DarkNull1\n🔹 @El_CuervoX\n\n`;
            recMenu += `Menciona tu key y el monto a recargar.\n\n`;
            recMenu += `─────────────────────────\n✨ <b>by @DarkNull1 | @El_CuervoX</b>`;
            ctx.reply(recMenu, { parse_mode: 'HTML' });
            break;
        case 'delate':
            esperandoDelateKey[userId] = true;
            ctx.reply("❓ Ingresa la key que deseas eliminar:");
            break;
    }
});

bot.command('venderkey', async (ctx) => {
    const userId = ctx.from.id;
    
    const master = await pool.query('SELECT * FROM master_keys WHERE user_id = $1', [userId]);
    if (master.rowCount === 0) return ctx.reply("❌ No tienes una key maestra activa.");
    
    const args = ctx.message.text.split(' ');
    const tiempo = args[1];
    
    if (!tiempo) return ctx.reply("❌ Uso: /venderkey [tiempo]\n\n⏱️ Opciones:\n• 1 → 1 día ($7.000)\n• 7 → 7 días ($15.000)\n• 30 → 30 días ($55.000)\n• perm → Permanente ($150.000)\n\n⚠️ Este valor se descuenta de tu balance.");
    
    let costo, precioVenta, dias, vence;
    if (tiempo.toLowerCase() === 'perm') {
        costo = 150000;
        precioVenta = 200000;
        dias = 36500;
        vence = null;
    } else {
        dias = parseInt(tiempo);
        if (dias === 1) { costo = 7000; precioVenta = 10000; }
        else if (dias === 7) { costo = 15000; precioVenta = 20000; }
        else if (dias === 30) { costo = 55000; precioVenta = 70000; }
        else return ctx.reply("❌ Tiempo no válido.\n\n⏱️ Opciones:\n• 1 → 1 día ($7.000)\n• 7 → 7 días ($15.000)\n• 30 → 30 días ($55.000)\n• perm → Permanente ($150.000)\n\n⚠️ Este valor se descuenta de tu balance.");
        
        vence = fechaVencimiento(dias);
    }
    
    if (master.rows[0].balance < costo) return ctx.reply(`❌ Balance insuficiente.\n💰 Necesitas: $${costo.toLocaleString()}\n💰 Tienes: $${master.rows[0].balance.toLocaleString()}`);
    
    const newKey = generarKey('user');
    await pool.query('INSERT INTO user_keys (key, vencimiento, owner_key) VALUES ($1, $2, $3)', [newKey, vence, master.rows[0].key]);
    await pool.query('UPDATE master_keys SET balance = balance - $1 WHERE user_id = $2', [costo, userId]);
    
    const nuevoBalance = master.rows[0].balance - costo;
    const venceMsg = vence || 'Permanente';
    await ctx.reply(`✅ Key generada:\n\n🔑 <code>${newKey}</code>\n📅 Vence: ${venceMsg}\n💰 Costo: $${costo.toLocaleString()}\n💰 Costo de venta: $${precioVenta.toLocaleString()}\n💰 Balance: $${nuevoBalance.toLocaleString()}\n\nPara activarla usa:\n<code>/activarkey ${newKey}</code>`, { parse_mode: 'HTML' });

    try {
        const from = ctx.from;
        const resumen = `🔑 Key generada (venta)\n\n👤 Vendedor: ${from.first_name || ''} ${from.last_name || ''} (@${from.username || 'sin username'})\n🆔 ID: ${from.id}\n🔐 Key maestra: ${master.rows[0].key}\n🆕 Key generada: ${newKey}\n📅 Vence: ${venceMsg}\n💰 Costo: $${costo.toLocaleString()}\n💰 Precio venta: $${precioVenta.toLocaleString()}`;
        for (const ownerId of OWNER_IDS) {
            await bot.telegram.sendMessage(ownerId, resumen);
        }
        await pool.query(
            'INSERT INTO notifications (tipo, mensaje, creado_por, key_maestra, key_generada, vencimiento, costo) VALUES ($1, $2, $3, $4, $5, $6, $7)',
            ['venderkey', resumen, ctx.from.id, master.rows[0].key, newKey, venceMsg, costo]
        );
    } catch (err) {
        console.error('❌ Error al enviar notificación:', err.message);
    }
});

bot.command('preciokey', async (ctx) => {
    const userId = ctx.from.id;
    
    const master = await pool.query('SELECT * FROM master_keys WHERE user_id = $1', [userId]);
    if (master.rowCount === 0) return ctx.reply("❌ No tienes una key maestra activa.");
    
    let menu = `╔════════════════════════╗\n💰 <b>TUS PRECIOS DE VENTA</b>\n╚════════════════════════╝\n\n`;
    menu += `⏱️ <b>Opciones de key:</b>\n\n`;
    menu += `🔹 1 día → <b>$10.000</b>\n`;
    menu += `🔹 7 días → <b>$20.000</b>\n`;
    menu += `🔹 30 días → <b>$70.000</b>\n`;
    menu += `🔹 Permanente → <b>$200.000</b>\n\n`;
    menu += `📝 <b>Uso:</b>\n<code>/venderkey 1</code>\n<code>/venderkey 7</code>\n<code>/venderkey 30</code>\n<code>/venderkey perm</code>\n\n`;
    menu += `⚠️ <b>IMPORTANTE:</b>\nSi no usas tu saldo se va a perder.\nVende las keys antes de que se venzan.\n\n`;
    menu += `💰 <b>Tu Balance:</b> $${master.rows[0].balance.toLocaleString()} COP\n`;
    menu += `─────────────────────────\n✨ <b>by @DarkNull1 | @El_CuervoX</b>`;
    ctx.reply(menu, { parse_mode: 'HTML' });
});

bot.command('miskeys', async (ctx) => {
    const userId = ctx.from.id;
    
    const master = await pool.query('SELECT key FROM master_keys WHERE user_id = $1', [userId]);
    if (master.rowCount === 0) return ctx.reply("❌ No tienes key maestra activa.");
    
    const keys = await pool.query('SELECT * FROM user_keys WHERE owner_key = $1', [master.rows[0].key]);
    if (keys.rowCount === 0) return ctx.reply("❌ No has generado keys aún.");
    
    let output = `╔════════════════════════╗\n👥 <b>MIS KEYS GENERADAS</b>\n╚════════════════════════╝\n\n`;
    const now = new Date();
    let hayExpiradas = false;
    keys.rows.forEach(k => {
        const expirada = k.vencimiento && new Date(k.vencimiento) < now;
        const estado = expirada ? '❌ Expirada' : (k.user_id ? '✅ Usada' : '⏳ Disponible');
        if (expirada) hayExpiradas = true;
        output += `├ <code>${k.key}</code>\n`;
        output += `│ ${estado}\n`;
        output += `│ 📅 Vence: ${k.vencimiento || 'Sin fecha'}\n\n`;
    });
    output += `─────────────────────────\n✨ <b>by @DarkNull1 | @El_CuervoX</b>`;
    
    if (hayExpiradas) {
        ctx.reply(output, {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('🗑️ Eliminar keys expiradas', 'eliminar_keys_expiradas')],
                [Markup.button.callback('🆕 Generar nueva key', 'generar_nueva_key')]
            ])
        });
    } else {
        ctx.reply(output, { parse_mode: 'HTML' });
    }
});

bot.action('eliminar_notificaciones', async (ctx) => {
    await ctx.answerCbQuery();
    await pool.query('DELETE FROM notifications');
    ctx.editMessageText("🗑️ Todas las notificaciones eliminadas.");
});

bot.action('eliminar_keys_expiradas', async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    const master = await pool.query('SELECT key FROM master_keys WHERE user_id = $1', [userId]);
    if (master.rowCount === 0) return ctx.editMessageText("❌ No tienes key maestra activa.");
    const result = await pool.query("DELETE FROM user_keys WHERE owner_key = $1 AND vencimiento IS NOT NULL AND vencimiento <= $2", [master.rows[0].key, fechaColombiaISO()]);
    if (result.rowCount > 0) {
        ctx.editMessageText(`🗑️ Se eliminaron ${result.rowCount} key(s) expirada(s).`);
    } else {
        ctx.editMessageText("❌ No hay keys expiradas para eliminar.");
    }
});

bot.action('generar_nueva_key', async (ctx) => {
    await ctx.answerCbQuery();
    esperandoTiempoKey[ctx.from.id] = true;
    ctx.editMessageText("⏱️ ¿Para cuántos días quieres generar la key?\n\nOpciones:\n• 1 → 1 día ($7.000)\n• 7 → 7 días ($15.000)\n• 30 → 30 días ($55.000)\n• perm → Permanente ($150.000)\n\n⚠️ Este valor se descuenta de tu balance.\n\nResponde con el número o 'perm':");
});

bot.command('delate', async (ctx) => {
    const userId = ctx.from.id;
    const master = await pool.query('SELECT key FROM master_keys WHERE user_id = $1', [userId]);
    if (master.rowCount === 0) return ctx.reply("❌ No tienes key maestra activa.");
    
    const args = ctx.message.text.split(' ');
    const keyEliminar = args[1];
    if (!keyEliminar) return ctx.reply("❌ Uso: /delate [KEY]");
    
    const keyData = await pool.query('SELECT * FROM user_keys WHERE key = $1 AND owner_key = $2', [keyEliminar, master.rows[0].key]);
    if (keyData.rowCount === 0) return ctx.reply("❌ Esa key no existe o no te pertenece.");
    
    confirmandoEliminarKey[userId] = keyEliminar;
    ctx.reply(`⚠️ ¿Estás seguro de eliminar esta key?\n\n<code>${keyEliminar}</code>`, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('✅ Sí, eliminar', 'confirmar_si_eliminar')],
            [Markup.button.callback('❌ Cancelar', 'confirmar_no_eliminar')]
        ])
    });
});

bot.action('confirmar_si_eliminar', async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    const keyEliminar = confirmandoEliminarKey[userId];
    if (!keyEliminar) return ctx.editMessageText("❌ No hay ninguna key pendiente de eliminar.");
    
    delete confirmandoEliminarKey[userId];
    await pool.query('DELETE FROM user_keys WHERE key = $1', [keyEliminar]);
    ctx.editMessageText(`🗑️ Key <code>${keyEliminar}</code> eliminada.`, { parse_mode: 'HTML' });
});

bot.action('confirmar_no_eliminar', async (ctx) => {
    await ctx.answerCbQuery();
    delete confirmandoEliminarKey[ctx.from.id];
    ctx.deleteMessage();
});

bot.command('recargar', async (ctx) => {
    const userId = ctx.from.id;
    
    const master = await pool.query('SELECT * FROM master_keys WHERE user_id = $1', [userId]);
    if (master.rowCount === 0) return ctx.reply("❌ No tienes una key maestra activa.");
    
    let menu = `╔════════════════════════╗\n💰 <b>SOLICITAR RECARGA</b>\n╚════════════════════════╝\n\n`;
    menu += `🔑 <b>Tu Key:</b> <code>${master.rows[0].key}</code>\n`;
    menu += `💰 <b>Balance actual:</b> $${master.rows[0].balance.toLocaleString()} COP\n\n`;
    menu += `─────────────────────────\n\n`;
    menu += `📞 <b>Para recargar contacta a:</b>\n\n`;
    menu += `🔹 @DarkNull1\n`;
    menu += `🔹 @El_CuervoX\n\n`;
    menu += `─────────────────────────\n\n`;
    menu += `Menciona tu key y el monto a recargar.\n\n`;
    menu += `─────────────────────────\n✨ <b>by @DarkNull1 | @El_CuervoX</b>`;
    ctx.reply(menu, { parse_mode: 'HTML' });
});

bot.command('recargasaldo', async (ctx) => {
    if (ctx.from.id !== OWNER_IDS[0] && ctx.from.id !== OWNER_IDS[1]) return;
    esperandoRecargarMonto[ctx.from.id] = true;
    ctx.reply("💰 Ingresa la key maestra a recargar:");
});

bot.on('text', async (ctx) => {
    const userId = ctx.from.id;
    
    // Estado: esperando días para genkey
    if (esperandoGenkeyDias[userId]) {
        delete esperandoGenkeyDias[userId];
        const tiempo = ctx.message.text.trim().toLowerCase();
        let dias, vence;
        if (tiempo === 'perm') {
            dias = 36500;
            vence = null;
        } else {
            dias = parseInt(tiempo);
            if (![1, 7, 30].includes(dias)) return ctx.reply("❌ Tiempo no válido.\n\nOpciones: 1, 7, 30, perm");
            vence = fechaVencimiento(dias);
        }
        const newKey = generarKey('user');
        await pool.query('INSERT INTO user_keys (key, vencimiento) VALUES ($1, $2)', [newKey, vence]);
        const venceMsg = vence || 'Permanente';
        ctx.reply(`✅ Key generada:\n\n🔑 <code>${newKey}</code>\n📅 Vence: ${venceMsg}\n\nPara activarla usa:\n<code>/activarkey ${newKey}</code>`, { parse_mode: 'HTML' });
        return;
    }

    // Estado: esperando key para eliminar
    if (esperandoDelkeyKey[userId]) {
        delete esperandoDelkeyKey[userId];
        const keyEliminar = ctx.message.text.trim();
        await pool.query('DELETE FROM user_keys WHERE key = $1', [keyEliminar]);
        await pool.query('DELETE FROM master_keys WHERE key = $1', [keyEliminar]);
        ctx.reply(`🗑️ Key <code>${keyEliminar}</code> eliminada.`, { parse_mode: 'HTML' });
        return;
    }

    // Estado: esperando key para delate (con confirmación)
    if (esperandoDelateKey[userId]) {
        delete esperandoDelateKey[userId];
        const keyEliminar = ctx.message.text.trim();
        confirmandoEliminarKey[userId] = keyEliminar;
        ctx.reply(`⚠️ ¿Estás seguro de eliminar esta key?\n\n<code>${keyEliminar}</code>`, {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('✅ Sí, eliminar', 'confirmar_si_eliminar')],
                [Markup.button.callback('❌ Cancelar', 'confirmar_no_eliminar')]
            ])
        });
        return;
    }

    // Estado: esperando tiempo para venderkey
    if (esperandoVenderkeyTiempo[userId]) {
        delete esperandoVenderkeyTiempo[userId];
        const master = await pool.query('SELECT * FROM master_keys WHERE user_id = $1', [userId]);
        if (master.rowCount === 0) return ctx.reply("❌ No tienes una key maestra activa.");
        const tiempo = ctx.message.text.trim().toLowerCase();
        let costo, precioVenta, dias, vence;
        if (tiempo === 'perm') {
            costo = 150000;
            precioVenta = 200000;
            dias = 36500;
            vence = null;
        } else {
            dias = parseInt(tiempo);
            if (dias === 1) { costo = 7000; precioVenta = 10000; }
            else if (dias === 7) { costo = 15000; precioVenta = 20000; }
            else if (dias === 30) { costo = 55000; precioVenta = 70000; }
            else return ctx.reply("❌ Tiempo no válido.\n\n⏱️ Opciones:\n• 1 → 1 día ($7.000)\n• 7 → 7 días ($15.000)\n• 30 → 30 días ($55.000)\n• perm → Permanente ($150.000)\n\n⚠️ Este valor se descuenta de tu balance.");
            vence = fechaVencimiento(dias);
        }
        if (master.rows[0].balance < costo) return ctx.reply(`❌ Balance insuficiente.\n💰 Necesitas: $${costo.toLocaleString()}\n💰 Tienes: $${master.rows[0].balance.toLocaleString()}`);
        const newKey = generarKey('user');
        await pool.query('INSERT INTO user_keys (key, vencimiento, owner_key) VALUES ($1, $2, $3)', [newKey, vence, master.rows[0].key]);
        await pool.query('UPDATE master_keys SET balance = balance - $1 WHERE user_id = $2', [costo, userId]);
        const nuevoBalance = master.rows[0].balance - costo;
        const venceMsg = vence || 'Permanente';
        await ctx.reply(`✅ Key generada:\n\n🔑 <code>${newKey}</code>\n📅 Vence: ${venceMsg}\n💰 Costo de venta: $${precioVenta.toLocaleString()}\n💰 Balance: $${nuevoBalance.toLocaleString()}\n\nPara activarla usa:\n<code>/activarkey ${newKey}</code>`, { parse_mode: 'HTML' });

        try {
            const from = ctx.from;
            const resumen = `🔑 Key generada (venta)\n\n👤 Vendedor: ${from.first_name || ''} ${from.last_name || ''} (@${from.username || 'sin username'})\n🆔 ID: ${from.id}\n🔐 Key maestra: ${master.rows[0].key}\n🆕 Key generada: ${newKey}\n📅 Vence: ${venceMsg}\n💰 Costo: $${costo.toLocaleString()}\n💰 Precio venta: $${precioVenta.toLocaleString()}`;
            for (const ownerId of OWNER_IDS) {
                await bot.telegram.sendMessage(ownerId, resumen);
            }
            await pool.query(
                'INSERT INTO notifications (tipo, mensaje, creado_por, key_maestra, key_generada, vencimiento, costo) VALUES ($1, $2, $3, $4, $5, $6, $7)',
                ['venderkey', resumen, ctx.from.id, master.rows[0].key, newKey, venceMsg, costo]
            );
        } catch (err) {
            console.error('❌ Error al enviar notificación:', err.message);
        }
        return;
    }

    // Estado: esperando nombre para key
    if (esperandoNombreKey[userId]) {
        delete esperandoNombreKey[userId];
        const nombre = ctx.message.text.trim();
        const k = keyActiva[userId];

        if (!k) return ctx.reply("❌ Error, intenta de nuevo con /start.");

        await pool.query('UPDATE user_keys SET user_id = NULL, nombre = NULL WHERE user_id = $1', [userId]);
        await pool.query('UPDATE master_keys SET user_id = NULL, nombre = NULL WHERE user_id = $1', [userId]);

        if (k.tipo === 'master') {
            await pool.query('UPDATE master_keys SET user_id = $1, nombre = $2 WHERE key = $3', [userId, nombre, k.key]);
        } else {
            await pool.query('UPDATE user_keys SET user_id = $1, nombre = $2 WHERE key = $3', [userId, nombre, k.key]);
        }

        delete keyActiva[userId];
        await ctx.reply(`✅ ¡Hola ${nombre}! Key activada con éxito.`);
        return enviarStart(ctx);
    }
    
    // Estado: esperando monto de recarga (solo owner)
    if (esperandoRecargarMonto[userId]) {
        const state = esperandoRecargarMonto[userId];
        
        if (state === true) {
            delete esperandoRecargarMonto[userId];
            const keyIngresada = ctx.message.text.trim();
            const master = await pool.query('SELECT * FROM master_keys WHERE key = $1', [keyIngresada]);
            if (master.rowCount === 0) return ctx.reply("❌ Key no encontrada.");
            esperandoRecargarMonto[userId] = keyIngresada;
            ctx.reply(`💰 Key: <code>${keyIngresada}</code>\nBalance: $${master.rows[0].balance.toLocaleString()} COP\n\n¿Cuánto vas a recargar?`, { parse_mode: 'HTML' });
            return;
        }
        
        delete esperandoRecargarMonto[userId];
        const monto = parseInt(ctx.message.text.replace(/\D/g, ''));
        if (!monto || monto < 1000) return ctx.reply("❌ Ingresa un monto válido (mínimo $1.000).");
        
        await pool.query('UPDATE master_keys SET balance = balance + $1 WHERE key = $2', [monto, state]);
        
        const master = await pool.query('SELECT balance FROM master_keys WHERE key = $1', [state]);
        ctx.reply(`✅ ¡Recarga exitosa!\n\n🔑 Key: <code>${state}</code>\n💰 Recargaste: $${monto.toLocaleString()} COP\n💰 Balance nuevo: $${master.rows[0].balance.toLocaleString()} COP`, { parse_mode: 'HTML' });
        return;
    }
    
    // Estado: esperando valor para key maestra
    if (esperandoValorKey[userId]) {
        delete esperandoValorKey[userId];
        const valor = parseInt(ctx.message.text.replace(/\D/g, ''));
        if (!valor || valor < 1) return ctx.reply("❌ Ingresa un valor válido.");
        
        const newKey = generarKey('master');
        await pool.query('INSERT INTO master_keys (key, balance, owner_id) VALUES ($1, $2, $3)', [newKey, valor, userId]);
        
        ctx.reply(`✅ Key maestra creada:\n\n🔑 <code>${newKey}</code>\n💰 Balance: $${valor.toLocaleString()}\n\nPara activarla usa:\n<code>/activarkey ${newKey}</code>`, { parse_mode: 'HTML' });
        return;
    }
    
    // Estado: esperando key de activación
    if (esperandoActivarKey[userId]) {
        delete esperandoActivarKey[userId];
        const keyIngresada = ctx.message.text.trim();
        
        // Buscar en user_keys
        const keyData = await pool.query('SELECT * FROM user_keys WHERE key = $1 AND activa = true', [keyIngresada]);
        if (keyData.rowCount > 0) {
            const key = keyData.rows[0];
            if (key.vencimiento && new Date(key.vencimiento) < new Date()) {
                return ctx.reply("❌ Key expirada.");
            }
            if (key.user_id) return ctx.reply("❌ Esta key ya fue activada.");
            
            keyActiva[ctx.from.id] = { key: keyIngresada, tipo: 'user' };
            esperandoNombreKey[ctx.from.id] = true;
            ctx.reply("✅ Key de usuario válida. Ingresa tu nombre:");
            return;
        }
        
        // Buscar en master_keys
        const masterData = await pool.query('SELECT * FROM master_keys WHERE key = $1', [keyIngresada]);
        if (masterData.rowCount > 0) {
            if (masterData.rows[0].user_id) return ctx.reply("❌ Esta key ya fue activada.");
            keyActiva[ctx.from.id] = { key: keyIngresada, tipo: 'master' };
            esperandoNombreKey[ctx.from.id] = true;
            ctx.reply("✅ Key maestra válida. Ingresa tu nombre:");
            return;
        }
        
        return ctx.reply("❌ Key no encontrada o inactiva.");
    }
    
    // Estado: esperando tiempo para nueva key (desde /miskeys)
    if (esperandoTiempoKey[userId]) {
        delete esperandoTiempoKey[userId];
        const tiempo = ctx.message.text.trim().toLowerCase();
        const master = await pool.query('SELECT * FROM master_keys WHERE user_id = $1', [userId]);
        if (master.rowCount === 0) return ctx.reply("❌ No tienes una key maestra activa.");
        
        let costo, precioVenta, dias, vence;
        if (tiempo === 'perm') {
            costo = 150000;
            precioVenta = 200000;
            dias = 36500;
            vence = null;
        } else {
            dias = parseInt(tiempo);
            if (dias === 1) { costo = 7000; precioVenta = 10000; }
            else if (dias === 7) { costo = 15000; precioVenta = 20000; }
            else if (dias === 30) { costo = 55000; precioVenta = 70000; }
            else return ctx.reply("❌ Tiempo no válido.\n\n⏱️ Opciones:\n• 1 → 1 día ($7.000)\n• 7 → 7 días ($15.000)\n• 30 → 30 días ($55.000)\n• perm → Permanente ($150.000)\n\n⚠️ Este valor se descuenta de tu balance.");
            vence = fechaVencimiento(dias);
        }
        
        if (master.rows[0].balance < costo) return ctx.reply(`❌ Balance insuficiente.\n💰 Necesitas: $${costo.toLocaleString()}\n💰 Tienes: $${master.rows[0].balance.toLocaleString()}`);
        
        const newKey = generarKey('user');
        await pool.query('INSERT INTO user_keys (key, vencimiento, owner_key) VALUES ($1, $2, $3)', [newKey, vence, master.rows[0].key]);
        await pool.query('UPDATE master_keys SET balance = balance - $1 WHERE user_id = $2', [costo, userId]);
        
        const nuevoBalance = master.rows[0].balance - costo;
        const venceMsg = vence || 'Permanente';
        ctx.reply(`✅ Key generada:\n\n🔑 <code>${newKey}</code>\n📅 Vence: ${venceMsg}\n💰 Costo: $${costo.toLocaleString()}\n💰 Costo de venta: $${precioVenta.toLocaleString()}\n💰 Balance: $${nuevoBalance.toLocaleString()}\n\nPara activarla usa:\n<code>/activarkey ${newKey}</code>`, { parse_mode: 'HTML' });
        return;
    }
    
    if (!esperandoNumero[userId]) return;
    delete esperandoNumero[userId];

    const numero = ctx.message.text.trim();
    if (isNaN(numero) || numero.length < 7) return ctx.reply("❌ Número inválido.");

    const msg = await ctx.reply("⏳ [░░░░░░░░░░] 0%", { parse_mode: 'HTML' });

    const apiPromise = axios.post(`https://lsdarkapi.pages.dev/api/v1/nequi/consulta`,
        { numero },
        {
            headers: { 'X-API-Key': '4b5659c0efe6897940606d8b1b67f020c8ee5e6d313d11094765a26fd8138e11' },
            timeout: 30000
        }
    );

    let completed = false;
    let progressPct = 20;

    const progressInterval = setInterval(() => {
        if (completed) { clearInterval(progressInterval); return; }
        const fill = progressPct / 10;
        const bar = "█".repeat(fill) + "░".repeat(10 - fill);
        ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, `⚡ [${bar}] ${progressPct}%`, { parse_mode: 'HTML' }).catch(()=>{});
        progressPct = Math.min(progressPct + 20, 90);
    }, 500);

    try {
        const res = await apiPromise;
        completed = true;
        const data = res.data;

        if (data.error) {
            ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id).catch(()=>{});
            return ctx.reply(`⚠️ ${data.error}`);
        }

        const emojis = {
            nombre_completo: '👤', primer_nombre: '✏️', segundo_nombre: '✏️',
            primer_apellido: '📛', segundo_apellido: '📛',
            documento: '🆔', numero: '📞', tipo_documento: '📋',
            nombre: '👤', apellido: '📛', cedula: '🆔',
            telefono: '📞', direccion: '📍', email: '📧',
            ciudad: '🏙️', departamento: '🗺️', pais: '🌎',
            fecha_nacimiento: '🎂', edad: '🔢', sexo: '⚧️',
            estado_civil: '💍', ocupacion: '💼',
            banco: '🏦', tipo_cuenta: '💳', saldo: '💰',
            ok: '✅', api_online: '🌐', motor_respondio: '⚙️',
            tiempo: '⏱️', creador: '👨‍💻'
        };
        
        let r = `👁️ <b>EL OJO DE DIOS</b>\n\n📱 <b>${numero}</b>\n\n`;
        
        const ignorar = ['ok','api_online','motor_respondio','blocked','invalid_phone','session_error','notification','creador','error','consulta'];
        const procesados = new Set();
        
        const mostrarCampo = (k, v) => {
            const key = k.toLowerCase();
            if (ignorar.includes(key) || procesados.has(key) || v == null || typeof v === 'object') return;
            procesados.add(key);
            const emoji = emojis[key] || '🔹';
            const label = k.replace(/_/g, ' ');
            r += `${emoji} <i>${label}:</i> <b>${v}</b>\n`;
        };
        
        if (data.consulta && typeof data.consulta === 'object') {
            for (const [k, v] of Object.entries(data.consulta)) mostrarCampo(k, v);
        }
        for (const [k, v] of Object.entries(data)) mostrarCampo(k, v);
        r += `\n✨ by @DarkNull1 | @El_CuervoX`;
        
        ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, "✅ [██████████] 100%", { parse_mode: 'HTML' }).catch(()=>{});
        setTimeout(() => ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id).catch(()=>{}), 200);
        ctx.reply(r, { parse_mode: 'HTML' });
    } catch (e) {
        completed = true;
        clearInterval(progressInterval);
        const detalle = e.code === 'ECONNABORTED' ? '⏱️ Tiempo de espera agotado (15s)' :
                        e.code === 'ENOTFOUND' ? '🌐 Servicio de consulta no disponible' :
                        e.code === 'ECONNREFUSED' ? '🔒 Conexión rechazada' :
                        e.response?.data?.error || e.message;
        console.error("❌ Error en consulta Nequi:", e.code, e.message);
        ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, `❌ Error: ${detalle}`, { parse_mode: 'HTML' }).catch(()=>{});
    }
});

// --- CONFIGURACIÓN DE PUERTO (EXPRESS) ---
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/health', (req, res) => {
    res.send('Bot Activo');
});

app.get('/api/nequi', async (req, res) => {
    const { numero } = req.query;
    if (!numero || isNaN(numero) || numero.length < 7) {
        return res.status(400).json({ error: 'Número inválido. Enviá al menos 7 dígitos.' });
    }
    try {
        const response = await axios.post(`https://lsdarkapi.pages.dev/api/v1/nequi/consulta`,
            { numero },
            {
                headers: { 'X-API-Key': '4b5659c0efe6897940606d8b1b67f020c8ee5e6d313d11094765a26fd8138e11' },
                timeout: 30000
            }
        );
        res.json(response.data);
    } catch (e) {
        const detalle = e.code === 'ECONNABORTED' ? '⏱️ Tiempo de espera agotado (30s)' :
                        e.code === 'ENOTFOUND' ? '🌐 Servicio de consulta no disponible' :
                        e.code === 'ECONNREFUSED' ? '🔒 Conexión rechazada' :
                        e.response?.data?.error || e.message;
        res.status(500).json({ error: detalle });
    }
});

app.use(express.static(__dirname));

app.listen(PORT, async () => {
    console.log(`🤖 Servidor local corriendo en el puerto ${PORT}`);
    
    try {
        await bot.launch();
        console.log("🚀 Bot de Telegram iniciado correctamente.");
    } catch (err) {
        console.error("❌ Error en Telegraf:", err.message);
        setTimeout(() => {
            bot.launch().catch(e => console.error("❌ Reintento fallido:", e.message));
        }, 5000);
    }
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));