const express  = require("express")
const multer   = require("multer")
const fs       = require("fs")
const cors     = require("cors")
const { createClient } = require("@supabase/supabase-js")

const app = express()

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options",    "nosniff")
  res.setHeader("X-Frame-Options",           "DENY")
  res.setHeader("X-XSS-Protection",          "1; mode=block")
  res.setHeader("Referrer-Policy",           "no-referrer")
  res.setHeader("Permissions-Policy",        "geolocation=(), microphone=(), camera=()")
  res.removeHeader("X-Powered-By")
  next()
})

const ORIGENS_PERMITIDAS = (process.env.ALLOWED_ORIGINS || "")
  .split(",").map(s => s.trim()).filter(Boolean)

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true)
    if (ORIGENS_PERMITIDAS.length === 0 || ORIGENS_PERMITIDAS.includes(origin)) return cb(null, true)
    cb(new Error("CORS bloqueado"))
  },
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}))

app.use(express.json({ limit: "1mb" }))

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_KEY
const ADMIN_TOKEN  = process.env.ADMIN_TOKEN

if (!SUPABASE_URL || !SUPABASE_KEY) { console.error("ERRO: SUPABASE_URL e SUPABASE_KEY obrigatórias."); process.exit(1) }
if (!ADMIN_TOKEN) console.warn("AVISO: ADMIN_TOKEN não definido.")

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
if (!fs.existsSync("temp")) fs.mkdirSync("temp")

function exigirAdmin(req, res, next) {
  if (!ADMIN_TOKEN) return next()
  const token = (req.headers["authorization"] || "").replace("Bearer ", "")
  if (token !== ADMIN_TOKEN) return res.status(403).json({ status: "erro", message: "Acesso negado." })
  next()
}

async function exigirUsuario(req, res, next) {
  const token = (req.headers["authorization"] || "").replace("Bearer ", "")
  if (!token) return res.status(401).json({ status: "erro", message: "Não autenticado." })
  try {
    const { data, error } = await supabase.auth.getUser(token)
    if (error || !data?.user) throw new Error()
    req.userId = data.user.id
    next()
  } catch {
    res.status(401).json({ status: "erro", message: "Sessão inválida." })
  }
}

const upload = multer({ dest: "temp/", limits: { fileSize: 500 * 1024 * 1024 } })

async function uploadStorage(filePath, fileName, mimetype) {
  const buf = fs.readFileSync(filePath)
  console.log("Tentando upload:", fileName, mimetype, buf.length, "bytes")
  const { data, error } = await supabase.storage.from("livros").upload(fileName, buf, { contentType: mimetype, upsert: true })
  console.log("Resultado upload:", JSON.stringify(error || data))
  if (error) throw error
  return supabase.storage.from("livros").getPublicUrl(fileName).data.publicUrl
}

// ─── ROTAS ───────────────────────────────────────────────

app.get("/", (req, res) => res.json({ status: "ok" }))

app.post("/login", (req, res) => {
  const { user, password } = req.body
  const ADMIN_USER = process.env.ADMIN_USER || "admin"
  const ADMIN_PASS = process.env.ADMIN_PASS
  if (!ADMIN_PASS) return res.status(500).json({ status: "erro", message: "Admin não configurado." })
  if (user === ADMIN_USER && password === ADMIN_PASS) {
    res.json({ status: "ok", role: "admin", token: ADMIN_TOKEN || "" })
  } else {
    setTimeout(() => res.status(401).json({ status: "erro", message: "Credenciais inválidas." }), 500)
  }
})

app.get("/livros", async (req, res) => {
  try {
    const { data, error } = await supabase.from("livros").select("*").order("id", { ascending: false })
    if (error) throw error
    res.json(data)
  } catch {
    res.status(500).json({ status: "erro", message: "Erro ao buscar livros." })
  }
})

// Adicionar livro — arquivo principal + capa opcional
app.post("/addLivro", exigirAdmin, upload.fields([
  { name: "arquivo", maxCount: 1 },
  { name: "capa",    maxCount: 1 }
]), async (req, res) => {
  const arquivoFile = req.files?.arquivo?.[0]
  const capaFile    = req.files?.capa?.[0]
  try {
    const { titulo, autor = "", descricao = "", tags: tagsRaw = "" } = req.body
    const tags = (tagsRaw.match(/#[\wÀ-ú]+/g) || []).map(t => t.slice(1).toLowerCase())

    if (!arquivoFile) return res.status(400).json({ status: "erro", message: "Nenhum arquivo enviado." })
    if (!titulo)      return res.status(400).json({ status: "erro", message: "Título obrigatório." })

    const ext    = (arquivoFile.originalname.split(".").pop() || "").toLowerCase()
    const extsOk = ["pdf","png","jpg","jpeg","webp"]
    if (!extsOk.includes(ext)) {
      fs.unlinkSync(arquivoFile.path)
      if (capaFile) fs.unlinkSync(capaFile.path)
      return res.status(400).json({ status: "erro", message: "Tipo de arquivo não permitido." })
    }

    const nomeArquivo = `${Date.now()}-${titulo.replace(/[^a-zA-Z0-9À-ú]/g,"_")}.${ext}`
    const publicUrl   = await uploadStorage(arquivoFile.path, nomeArquivo, arquivoFile.mimetype)
    fs.unlinkSync(arquivoFile.path)

    let capaUrl = null
    if (capaFile) {
      const extCapa = (capaFile.originalname.split(".").pop() || "").toLowerCase()
      if (["png","jpg","jpeg","webp"].includes(extCapa)) {
        const nomeCapa = `capa-${Date.now()}-${titulo.replace(/[^a-zA-Z0-9À-ú]/g,"_")}.${extCapa}`
        capaUrl = await uploadStorage(capaFile.path, nomeCapa, capaFile.mimetype)
      }
      fs.unlinkSync(capaFile.path)
    }

    const { error: dbError } = await supabase.from("livros")
      .insert([{ titulo, autor, descricao, tags, arquivo_url: publicUrl, capa_url: capaUrl }])
    if (dbError) throw dbError

    res.json({ status: "ok", url: publicUrl, capa_url: capaUrl })
  } catch (err) {
    console.error("Erro addLivro:", err)
    if (arquivoFile && fs.existsSync(arquivoFile.path)) fs.unlinkSync(arquivoFile.path)
    if (capaFile    && fs.existsSync(capaFile.path))    fs.unlinkSync(capaFile.path)
    res.status(500).json({ status: "erro", message: "Erro ao adicionar livro: " + err.message })
  }
})

// Editar livro — JSON ou multipart (com nova capa)
app.patch("/livros/:id", exigirAdmin, upload.fields([
  { name: "capa", maxCount: 1 }
]), async (req, res) => {
  const capaFile = req.files?.capa?.[0]
  try {
    const { id } = req.params
    if (!/^\d+$/.test(id)) return res.status(400).json({ status: "erro", message: "ID inválido." })

    const { titulo, autor, descricao, tags: tagsRaw } = req.body
    const updates = {}
    if (titulo    !== undefined) updates.titulo    = String(titulo).slice(0, 200)
    if (autor     !== undefined) updates.autor     = String(autor).slice(0, 200)
    if (descricao !== undefined) updates.descricao = String(descricao).slice(0, 1000)
    if (tagsRaw   !== undefined)
      updates.tags = (tagsRaw.match(/#[\wÀ-ú]+/g) || []).map(t => t.slice(1).toLowerCase())

    if (capaFile) {
      const extCapa = (capaFile.originalname.split(".").pop() || "").toLowerCase()
      if (["png","jpg","jpeg","webp"].includes(extCapa)) {
        const nomeCapa = `capa-${Date.now()}.${extCapa}`
        updates.capa_url = await uploadStorage(capaFile.path, nomeCapa, capaFile.mimetype)
      }
      fs.unlinkSync(capaFile.path)
    }

    if (!Object.keys(updates).length)
      return res.status(400).json({ status: "erro", message: "Nada para atualizar." })

    const { error } = await supabase.from("livros").update(updates).eq("id", id)
    if (error) throw error
    res.json({ status: "ok" })
  } catch {
    if (capaFile && fs.existsSync(capaFile.path)) fs.unlinkSync(capaFile.path)
    res.status(500).json({ status: "erro", message: "Erro ao editar livro." })
  }
})

app.delete("/livros/:id", exigirAdmin, async (req, res) => {
  try {
    const { id } = req.params
    if (!/^\d+$/.test(id)) return res.status(400).json({ status: "erro", message: "ID inválido." })

    const { data: livro, error: fetchError } = await supabase
      .from("livros").select("arquivo_url, capa_url").eq("id", id).single()
    if (fetchError) throw fetchError

    const arquivos = [livro.arquivo_url, livro.capa_url].filter(Boolean).map(u => u.split("/").pop())
    if (arquivos.length) await supabase.storage.from("livros").remove(arquivos)

    const { error: deleteError } = await supabase.from("livros").delete().eq("id", id)
    if (deleteError) throw deleteError

    res.json({ status: "ok" })
  } catch {
    res.status(500).json({ status: "erro", message: "Erro ao deletar livro." })
  }
})

// ── Anotações ──
app.get("/anotacoes", exigirUsuario, async (req, res) => {
  const { livro_url } = req.query
  if (!livro_url) return res.status(400).json({ status: "erro", message: "livro_url obrigatório." })
  try {
    const urlDec = decodeURIComponent(livro_url)
    const { data, error } = await supabase.from("anotacoes").select("pagina, texto")
      .eq("user_id", req.userId).in("livro_url", [urlDec, encodeURIComponent(urlDec), livro_url])
    if (error) throw error
    const mapa = {}
    data.forEach(a => { mapa[a.pagina] = a.texto })
    res.json(mapa)
  } catch {
    res.status(500).json({ status: "erro", message: "Erro ao buscar anotações." })
  }
})

app.post("/anotacoes", exigirUsuario, async (req, res) => {
  const { livro_url, pagina, texto } = req.body
  if (!livro_url || !pagina) return res.status(400).json({ status: "erro", message: "Parâmetros faltando." })
  const urlNorm = decodeURIComponent(livro_url)
  try {
    if (!texto || !String(texto).trim()) {
      await supabase.from("anotacoes").delete()
        .eq("user_id", req.userId).in("livro_url", [urlNorm, encodeURIComponent(urlNorm)]).eq("pagina", pagina)
    } else {
      const { error } = await supabase.from("anotacoes")
        .upsert({ user_id: req.userId, livro_url: urlNorm, pagina, texto: String(texto).slice(0,5000) },
                 { onConflict: "user_id,livro_url,pagina" })
      if (error) throw error
    }
    res.json({ status: "ok" })
  } catch {
    res.status(500).json({ status: "erro", message: "Erro ao salvar anotação." })
  }
})

// ── Highlights ──
app.get("/highlights", exigirUsuario, async (req, res) => {
  const { livro_url } = req.query
  if (!livro_url) return res.status(400).json({ status: "erro", message: "livro_url obrigatório." })
  try {
    const { data, error } = await supabase.from("highlights")
      .select("hl_id, pagina, cor, nota, img_data")
      .eq("user_id", req.userId).eq("livro_url", decodeURIComponent(livro_url))
    if (error) throw error
    res.json(data)
  } catch {
    res.status(500).json({ status: "erro", message: "Erro ao buscar highlights." })
  }
})

app.post("/highlights", exigirUsuario, async (req, res) => {
  const { hl_id, livro_url, pagina, cor, nota, img_data } = req.body
  if (!hl_id || !livro_url || !pagina) return res.status(400).json({ status: "erro", message: "Parâmetros faltando." })
  try {
    const { error } = await supabase.from("highlights")
      .upsert({ hl_id, user_id: req.userId, livro_url, pagina, cor, nota, img_data }, { onConflict: "hl_id" })
    if (error) throw error
    res.json({ status: "ok" })
  } catch {
    res.status(500).json({ status: "erro", message: "Erro ao salvar highlight." })
  }
})

app.delete("/highlights/:id", exigirUsuario, async (req, res) => {
  try {
    const { error } = await supabase.from("highlights").delete()
      .eq("hl_id", req.params.id).eq("user_id", req.userId)
    if (error) throw error
    res.json({ status: "ok" })
  } catch {
    res.status(500).json({ status: "erro", message: "Erro ao deletar highlight." })
  }
})

// ── Progresso ──
app.post("/progresso", exigirUsuario, async (req, res) => {
  const { livro_url, pagina } = req.body
  if (!livro_url || !pagina) return res.status(400).json({ status: "erro", message: "Parâmetros faltando." })
  try {
    const { error } = await supabase.from("progresso")
      .upsert({ user_id: req.userId, livro_url, pagina, updated_at: new Date().toISOString() },
               { onConflict: "user_id,livro_url" })
    if (error) throw error
    res.json({ status: "ok" })
  } catch {
    res.status(500).json({ status: "erro", message: "Erro ao salvar progresso." })
  }
})

app.get("/progresso", exigirUsuario, async (req, res) => {
  const { livro_url } = req.query
  if (!livro_url) return res.status(400).json({ status: "erro", message: "livro_url obrigatório." })
  try {
    const { data, error } = await supabase.from("progresso")
      .select("pagina").eq("user_id", req.userId).eq("livro_url", decodeURIComponent(livro_url)).single()
    if (error && error.code !== "PGRST116") throw error
    res.json({ pagina: data?.pagina || 1 })
  } catch {
    res.status(500).json({ status: "erro", message: "Erro ao buscar progresso." })
  }
})

// ─── VÍDEOS ──────────────────────────────────────────────

// Listar vídeos (público)
app.get("/videos", async (req, res) => {
  try {
    const { data, error } = await supabase.from("videos").select("*").order("id", { ascending: false })
    if (error) throw error
    res.json(data)
  } catch {
    res.status(500).json({ status: "erro", message: "Erro ao buscar vídeos." })
  }
})

// Adicionar vídeo (admin) — aceita arquivo de vídeo + capa opcional
app.post("/addVideo", exigirAdmin, upload.fields([
  { name: "arquivo", maxCount: 1 },
  { name: "capa",    maxCount: 1 }
]), async (req, res) => {
  const arquivoFile = req.files?.arquivo?.[0]
  const capaFile    = req.files?.capa?.[0]
  try {
    const {
      titulo, autor = "", descricao = "", tags: tagsRaw = "",
      link = "", links_relacionados = "", playlist_link = ""
    } = req.body
    const tags = (tagsRaw.match(/#[\wÀ-ú]+/g) || []).map(t => t.slice(1).toLowerCase())

    if (!titulo) return res.status(400).json({ status: "erro", message: "Título obrigatório." })
    if (!arquivoFile && !link) return res.status(400).json({ status: "erro", message: "Envie um arquivo ou forneça um link." })

    let videoUrl = link || null
    let capaUrl  = null

    // Upload de arquivo de vídeo (se enviado)
    if (arquivoFile) {
      const ext    = (arquivoFile.originalname.split(".").pop() || "").toLowerCase()
      const extsOk = ["mp4","webm","mov","avi","mkv"]
      if (!extsOk.includes(ext)) {
        fs.unlinkSync(arquivoFile.path)
        if (capaFile) fs.unlinkSync(capaFile.path)
        return res.status(400).json({ status: "erro", message: "Tipo de vídeo não permitido." })
      }
      const nomeVideo = `video-${Date.now()}-${titulo.replace(/[^a-zA-Z0-9À-ú]/g,"_")}.${ext}`
      videoUrl = await uploadStorage(arquivoFile.path, nomeVideo, arquivoFile.mimetype)
      fs.unlinkSync(arquivoFile.path)
    }

    // Upload de capa (se enviada)
    if (capaFile) {
      const extCapa = (capaFile.originalname.split(".").pop() || "").toLowerCase()
      if (["png","jpg","jpeg","webp"].includes(extCapa)) {
        const nomeCapa = `capa-video-${Date.now()}.${extCapa}`
        capaUrl = await uploadStorage(capaFile.path, nomeCapa, capaFile.mimetype)
      }
      fs.unlinkSync(capaFile.path)
    }

    const { error: dbError } = await supabase.from("videos").insert([{
      titulo, autor, descricao, tags,
      video_url: videoUrl,
      capa_url: capaUrl,
      link_externo: link || null,
      links_relacionados: links_relacionados || null,
      playlist_link: playlist_link || null
    }])
    if (dbError) throw dbError

    res.json({ status: "ok", video_url: videoUrl, capa_url: capaUrl })
  } catch (err) {
    console.error("Erro addVideo:", err)
    if (arquivoFile && fs.existsSync(arquivoFile.path)) fs.unlinkSync(arquivoFile.path)
    if (capaFile    && fs.existsSync(capaFile.path))    fs.unlinkSync(capaFile.path)
    res.status(500).json({ status: "erro", message: "Erro ao adicionar vídeo: " + err.message })
  }
})

// Editar vídeo (admin)
app.patch("/videos/:id", exigirAdmin, upload.fields([
  { name: "capa", maxCount: 1 }
]), async (req, res) => {
  const capaFile = req.files?.capa?.[0]
  try {
    const { id } = req.params
    if (!/^\d+$/.test(id)) return res.status(400).json({ status: "erro", message: "ID inválido." })

    const { titulo, autor, descricao, tags: tagsRaw, link, links_relacionados, playlist_link } = req.body
    const updates = {}
    if (titulo             !== undefined) updates.titulo             = String(titulo).slice(0, 200)
    if (autor              !== undefined) updates.autor              = String(autor).slice(0, 200)
    if (descricao          !== undefined) updates.descricao          = String(descricao).slice(0, 1000)
    if (link               !== undefined) updates.link_externo       = link
    if (links_relacionados !== undefined) updates.links_relacionados = links_relacionados
    if (playlist_link      !== undefined) updates.playlist_link      = playlist_link
    if (tagsRaw            !== undefined)
      updates.tags = (tagsRaw.match(/#[\wÀ-ú]+/g) || []).map(t => t.slice(1).toLowerCase())

    if (capaFile) {
      const extCapa = (capaFile.originalname.split(".").pop() || "").toLowerCase()
      if (["png","jpg","jpeg","webp"].includes(extCapa)) {
        const nomeCapa = `capa-video-${Date.now()}.${extCapa}`
        updates.capa_url = await uploadStorage(capaFile.path, nomeCapa, capaFile.mimetype)
      }
      fs.unlinkSync(capaFile.path)
    }

    if (!Object.keys(updates).length)
      return res.status(400).json({ status: "erro", message: "Nada para atualizar." })

    const { error } = await supabase.from("videos").update(updates).eq("id", id)
    if (error) throw error
    res.json({ status: "ok" })
  } catch {
    if (capaFile && fs.existsSync(capaFile.path)) fs.unlinkSync(capaFile.path)
    res.status(500).json({ status: "erro", message: "Erro ao editar vídeo." })
  }
})

// Deletar vídeo (admin)
app.delete("/videos/:id", exigirAdmin, async (req, res) => {
  try {
    const { id } = req.params
    if (!/^\d+$/.test(id)) return res.status(400).json({ status: "erro", message: "ID inválido." })

    const { data: video, error: fetchError } = await supabase
      .from("videos").select("video_url, capa_url, link_externo").eq("id", id).single()
    if (fetchError) throw fetchError

    // Remove arquivos do storage (só se for upload, não link externo)
    const arquivos = []
    if (video.video_url && !video.link_externo) arquivos.push(video.video_url.split("/").pop())
    if (video.capa_url)  arquivos.push(video.capa_url.split("/").pop())
    if (arquivos.length) await supabase.storage.from("livros").remove(arquivos)

    const { error: deleteError } = await supabase.from("videos").delete().eq("id", id)
    if (deleteError) throw deleteError

    res.json({ status: "ok" })
  } catch {
    res.status(500).json({ status: "erro", message: "Erro ao deletar vídeo." })
  }
})

// ─── PLAYLIST EM LOTE (admin) ────────────────────────────

// Importar múltiplos vídeos de uma pasta (upload em lote)
app.post("/addPlaylistBatch", exigirAdmin, upload.fields([
  { name: "videos",   maxCount: 50 },
  { name: "capas",    maxCount: 50 }
]), async (req, res) => {
  const videoFiles = req.files?.videos  || []
  const capaFiles  = req.files?.capas   || []

  try {
    const {
      playlist_nome = "Playlist importada",
      autor = "", tags: tagsRaw = "", publica = "false"
    } = req.body
    const tags = (tagsRaw.match(/#[\wÀ-ú]+/g) || []).map(t => t.slice(1).toLowerCase())

    if (!videoFiles.length)
      return res.status(400).json({ status: "erro", message: "Nenhum vídeo enviado." })

    const extsOk  = ["mp4","webm","mov","avi","mkv"]
    const extsCapa = ["png","jpg","jpeg","webp"]
    const resultados = []
    const idsVideos  = []

    for (let i = 0; i < videoFiles.length; i++) {
      const vf  = videoFiles[i]
      const cf  = capaFiles[i] || null
      const ext = (vf.originalname.split(".").pop() || "").toLowerCase()

      if (!extsOk.includes(ext)) {
        fs.unlinkSync(vf.path)
        if (cf) fs.unlinkSync(cf.path)
        resultados.push({ nome: vf.originalname, status: "ignorado", motivo: "extensão inválida" })
        continue
      }

      // Título = nome do arquivo sem extensão
      const titulo = vf.originalname.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ")
      const nomeVideo = `video-${Date.now()}-${i}-${titulo.replace(/[^a-zA-Z0-9À-ú]/g,"_")}.${ext}`

      let videoUrl, capaUrl = null
      try {
        videoUrl = await uploadStorage(vf.path, nomeVideo, vf.mimetype)
        fs.unlinkSync(vf.path)
      } catch (err) {
        if (fs.existsSync(vf.path)) fs.unlinkSync(vf.path)
        resultados.push({ nome: vf.originalname, status: "erro", motivo: err.message })
        continue
      }

      // Capa correspondente (mesmo índice)
      if (cf) {
        const extCapa = (cf.originalname.split(".").pop() || "").toLowerCase()
        if (extsCapa.includes(extCapa)) {
          try {
            const nomeCapa = `capa-video-${Date.now()}-${i}.${extCapa}`
            capaUrl = await uploadStorage(cf.path, nomeCapa, cf.mimetype)
          } catch {}
        }
        if (fs.existsSync(cf.path)) fs.unlinkSync(cf.path)
      }

      const { data: inserted, error: dbError } = await supabase.from("videos")
        .insert([{ titulo, autor, tags, video_url: videoUrl, capa_url: capaUrl }])
        .select("id").single()

      if (dbError) {
        resultados.push({ nome: vf.originalname, status: "erro", motivo: dbError.message })
        continue
      }
      idsVideos.push(inserted.id)
      resultados.push({ nome: vf.originalname, status: "ok", titulo, id: inserted.id })
    }

    // Criar playlist com todos os vídeos importados com sucesso
    let playlistId = null
    if (idsVideos.length) {
      const { data: pl } = await supabase.from("playlists").insert([{
        nome: playlist_nome, publica: publica === "true", videos: idsVideos,
        user_id: "00000000-0000-0000-0000-000000000000"
      }]).select("id").single()
      playlistId = pl?.id || null
    }

    res.json({ status: "ok", total: videoFiles.length, importados: idsVideos.length, playlistId, resultados })
  } catch (err) {
    console.error("Erro addPlaylistBatch:", err)
    // Limpar arquivos temporários restantes
    ;[...(videoFiles), ...(capaFiles)].forEach(f => { if (fs.existsSync(f.path)) fs.unlinkSync(f.path) })
    res.status(500).json({ status: "erro", message: "Erro ao importar playlist: " + err.message })
  }
})

// Importar playlist via link do YouTube (retorna metadados públicos)
app.post("/importPlaylistLink", exigirAdmin, async (req, res) => {
  const { playlist_url, playlist_nome, autor = "", tags: tagsRaw = "" } = req.body
  if (!playlist_url) return res.status(400).json({ status: "erro", message: "URL obrigatória." })

  const tags = (tagsRaw.match(/#[\wÀ-ú]+/g) || []).map(t => t.slice(1).toLowerCase())

  try {
    // Extrair ID da playlist do YouTube
    const plMatch = playlist_url.match(/[?&]list=([^&\s]+)/)
    if (!plMatch) {
      // Se não for playlist do YouTube, salvar como link único
      const { data: inserted } = await supabase.from("videos")
        .insert([{
          titulo: playlist_nome || "Playlist importada",
          autor, tags,
          link_externo: playlist_url,
          playlist_link: playlist_url
        }]).select("id").single()

      return res.json({ status: "ok", tipo: "link_simples", ids: [inserted?.id] })
    }

    const playlistId = plMatch[1]

    // Buscar vídeos da playlist via YouTube oEmbed / noembed (sem API key)
    // Estratégia: salvar a playlist inteira como um único vídeo com link
    const { data: inserted } = await supabase.from("videos")
      .insert([{
        titulo: playlist_nome || `Playlist YouTube`,
        autor, tags,
        link_externo: `https://www.youtube.com/playlist?list=${playlistId}`,
        playlist_link: playlist_url,
        capa_url: null
      }]).select("id").single()

    res.json({
      status: "ok",
      tipo: "youtube_playlist",
      playlistId,
      ids: [inserted?.id],
      embed_url: `https://www.youtube.com/embed/videoseries?list=${playlistId}`
    })
  } catch (err) {
    console.error("Erro importPlaylistLink:", err)
    res.status(500).json({ status: "erro", message: "Erro ao importar: " + err.message })
  }
})

// Playlists admin (criadas em lote) — listadas como públicas
app.get("/playlists_admin", async (req, res) => {
  try {
    const { data, error } = await supabase.from("playlists")
      .select("*").eq("publica", true).order("id", { ascending: false })
    if (error) throw error
    res.json(data)
  } catch {
    res.status(500).json({ status: "erro", message: "Erro ao buscar playlists admin." })
  }
})

// Listar playlists do usuário
app.get("/playlists", exigirUsuario, async (req, res) => {
  try {
    const { data, error } = await supabase.from("playlists")
      .select("*").eq("user_id", req.userId).order("id", { ascending: false })
    if (error) throw error
    res.json(data)
  } catch {
    res.status(500).json({ status: "erro", message: "Erro ao buscar playlists." })
  }
})

// Listar playlists públicas
app.get("/playlists/publicas", async (req, res) => {
  try {
    const { data, error } = await supabase.from("playlists")
      .select("*").eq("publica", true).order("id", { ascending: false })
    if (error) throw error
    res.json(data)
  } catch {
    res.status(500).json({ status: "erro", message: "Erro ao buscar playlists públicas." })
  }
})

// Criar playlist
app.post("/playlists", exigirUsuario, async (req, res) => {
  const { nome, descricao = "", publica = false, videos = [] } = req.body
  if (!nome) return res.status(400).json({ status: "erro", message: "Nome obrigatório." })
  try {
    const { data, error } = await supabase.from("playlists")
      .insert([{ user_id: req.userId, nome, descricao, publica, videos }])
      .select().single()
    if (error) throw error
    res.json({ status: "ok", id: data.id })
  } catch {
    res.status(500).json({ status: "erro", message: "Erro ao criar playlist." })
  }
})

// Editar playlist (só o dono)
app.patch("/playlists/:id", exigirUsuario, async (req, res) => {
  try {
    const { id } = req.params
    // Verificar dono
    const { data: pl, error: fetchError } = await supabase.from("playlists")
      .select("user_id").eq("id", id).single()
    if (fetchError || pl.user_id !== req.userId)
      return res.status(403).json({ status: "erro", message: "Sem permissão." })

    const { nome, descricao, publica, videos } = req.body
    const updates = {}
    if (nome      !== undefined) updates.nome      = String(nome).slice(0, 200)
    if (descricao !== undefined) updates.descricao = String(descricao).slice(0, 1000)
    if (publica   !== undefined) updates.publica   = !!publica
    if (videos    !== undefined) updates.videos    = videos

    const { error } = await supabase.from("playlists").update(updates).eq("id", id)
    if (error) throw error
    res.json({ status: "ok" })
  } catch {
    res.status(500).json({ status: "erro", message: "Erro ao editar playlist." })
  }
})

// Deletar playlist (só o dono)
app.delete("/playlists/:id", exigirUsuario, async (req, res) => {
  try {
    const { id } = req.params
    const { data: pl, error: fetchError } = await supabase.from("playlists")
      .select("user_id").eq("id", id).single()
    if (fetchError || pl.user_id !== req.userId)
      return res.status(403).json({ status: "erro", message: "Sem permissão." })

    const { error } = await supabase.from("playlists").delete().eq("id", id)
    if (error) throw error
    res.json({ status: "ok" })
  } catch {
    res.status(500).json({ status: "erro", message: "Erro ao deletar playlist." })
  }
})

app.use((req, res) => res.status(404).json({ status: "erro", message: "Rota não encontrada." }))

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`))
