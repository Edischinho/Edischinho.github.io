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

const upload = multer({ dest: "temp/", limits: { fileSize: 50 * 1024 * 1024 } })

async function uploadStorage(filePath, fileName, mimetype) {
  const buf = fs.readFileSync(filePath)
  const { error } = await supabase.storage.from("livros").upload(fileName, buf, { contentType: mimetype, upsert: true })
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

app.use((req, res) => res.status(404).json({ status: "erro", message: "Rota não encontrada." }))

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`))
