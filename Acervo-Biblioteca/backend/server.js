const express  = require("express")
const multer   = require("multer")
const fs       = require("fs")
const cors     = require("cors")
const rateLimit = require("express-rate-limit")
const { createClient } = require("@supabase/supabase-js")

const app = express()

// ── Segurança: headers HTTP ──
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options",    "nosniff")
  res.setHeader("X-Frame-Options",           "DENY")
  res.setHeader("X-XSS-Protection",          "1; mode=block")
  res.setHeader("Referrer-Policy",           "no-referrer")
  res.setHeader("Permissions-Policy",        "geolocation=(), microphone=(), camera=()")
  res.removeHeader("X-Powered-By")
  next()
})

// ── CORS: apenas origens conhecidas ──
const ORIGENS_PERMITIDAS = (process.env.ALLOWED_ORIGINS || "")
  .split(",").map(s => s.trim()).filter(Boolean)

app.use(cors({
  origin: (origin, cb) => {
    // Permite requisições sem origin (ex: Render health check, curl)
    if (!origin) return cb(null, true)
    if (ORIGENS_PERMITIDAS.length === 0 || ORIGENS_PERMITIDAS.includes(origin)) {
      return cb(null, true)
    }
    cb(new Error("CORS bloqueado: origem não permitida"))
  },
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}))

app.use(express.json({ limit: "1mb" }))

// ── Rate limiting ──
const limitadorGeral = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 min
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: "erro", message: "Muitas requisições. Tente novamente em 15 minutos." }
})

const limitadorLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,   // máx 10 tentativas de login por IP a cada 15 min
  message: { status: "erro", message: "Muitas tentativas de login. Aguarde 15 minutos." }
})

app.use(limitadorGeral)

// ── Credenciais — APENAS de variáveis de ambiente, nunca hardcoded ──
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_KEY
const ADMIN_TOKEN  = process.env.ADMIN_TOKEN   // token secreto para rotas admin

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("ERRO: SUPABASE_URL e SUPABASE_KEY são obrigatórias como variáveis de ambiente.")
  process.exit(1)
}
if (!ADMIN_TOKEN) {
  console.warn("AVISO: ADMIN_TOKEN não definido — rotas admin estarão desprotegidas.")
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

if (!fs.existsSync("temp")) fs.mkdirSync("temp")

// ── Middleware: verificar token admin ──
function exigirAdmin(req, res, next) {
  if (!ADMIN_TOKEN) return next()   // dev sem token configurado
  const auth  = req.headers["authorization"] || ""
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : ""
  if (token !== ADMIN_TOKEN) {
    return res.status(403).json({ status: "erro", message: "Acesso negado." })
  }
  next()
}

// ── Middleware: verificar JWT Supabase do usuário ──
async function exigirUsuario(req, res, next) {
  const auth  = req.headers["authorization"] || ""
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : ""
  if (!token) return res.status(401).json({ status: "erro", message: "Não autenticado." })

  try {
    const { data, error } = await supabase.auth.getUser(token)
    if (error || !data?.user) throw new Error("Token inválido")
    req.userId = data.user.id
    next()
  } catch {
    res.status(401).json({ status: "erro", message: "Sessão inválida. Faça login novamente." })
  }
}

const upload = multer({
  dest: "temp/",
  limits: { fileSize: 50 * 1024 * 1024 }  // 50MB máx
})

// ─── ROTAS ────────────────────────────────────────────────

app.get("/", (req, res) => res.json({ status: "ok" }))

// ── Login admin ──
app.post("/login", limitadorLogin, (req, res) => {
  const { user, password } = req.body
  const ADMIN_USER = process.env.ADMIN_USER || "admin"
  const ADMIN_PASS = process.env.ADMIN_PASS

  if (!ADMIN_PASS) {
    return res.status(500).json({ status: "erro", message: "Admin não configurado." })
  }
  if (user === ADMIN_USER && password === ADMIN_PASS) {
    res.json({ status: "ok", role: "admin", token: ADMIN_TOKEN || "" })
  } else {
    // Delay para dificultar timing attacks
    setTimeout(() => {
      res.status(401).json({ status: "erro", message: "Credenciais inválidas." })
    }, 500)
  }
})

// ── Listar livros (público) ──
app.get("/livros", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("livros").select("*").order("id", { ascending: false })
    if (error) throw error
    res.json(data)
  } catch (err) {
    res.status(500).json({ status: "erro", message: "Erro ao buscar livros." })
  }
})

// ── Adicionar livro (só admin) ──
app.post("/addLivro", exigirAdmin, upload.single("arquivo"), async (req, res) => {
  try {
    const { titulo, autor = "", descricao = "", tags: tagsRaw = "" } = req.body
    const tags = (tagsRaw.match(/#[\wÀ-ú]+/g) || []).map(t => t.slice(1).toLowerCase())

    if (!req.file) return res.status(400).json({ status: "erro", message: "Nenhum arquivo enviado." })
    if (!titulo)   return res.status(400).json({ status: "erro", message: "Título obrigatório." })

    // Validar extensão
    const ext     = (req.file.originalname.split(".").pop() || "").toLowerCase()
    const extsOk  = ["pdf","png","jpg","jpeg","webp"]
    if (!extsOk.includes(ext)) {
      fs.unlinkSync(req.file.path)
      return res.status(400).json({ status: "erro", message: "Tipo de arquivo não permitido." })
    }

    const fileName  = `${Date.now()}-${titulo.replace(/[^a-zA-Z0-9À-ú]/g,"_")}.${ext}`
    const fileBuffer = fs.readFileSync(req.file.path)

    const { error: uploadError } = await supabase.storage
      .from("livros").upload(fileName, fileBuffer, { contentType: req.file.mimetype, upsert: false })
    if (uploadError) throw uploadError

    const publicUrl = supabase.storage.from("livros").getPublicUrl(fileName).data.publicUrl

    const { error: dbError } = await supabase
      .from("livros").insert([{ titulo, autor, descricao, tags, arquivo_url: publicUrl }])
    if (dbError) throw dbError

    fs.unlinkSync(req.file.path)
    res.json({ status: "ok", url: publicUrl })
  } catch (err) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path)
    res.status(500).json({ status: "erro", message: "Erro ao adicionar livro." })
  }
})

// ── Editar livro (só admin) ──
app.patch("/livros/:id", exigirAdmin, async (req, res) => {
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

    if (!Object.keys(updates).length)
      return res.status(400).json({ status: "erro", message: "Nada para atualizar." })

    const { error } = await supabase.from("livros").update(updates).eq("id", id)
    if (error) throw error
    res.json({ status: "ok" })
  } catch {
    res.status(500).json({ status: "erro", message: "Erro ao editar livro." })
  }
})

// ── Deletar livro (só admin) ──
app.delete("/livros/:id", exigirAdmin, async (req, res) => {
  try {
    const { id } = req.params
    if (!/^\d+$/.test(id)) return res.status(400).json({ status: "erro", message: "ID inválido." })

    const { data: livro, error: fetchError } = await supabase
      .from("livros").select("arquivo_url").eq("id", id).single()
    if (fetchError) throw fetchError

    const fileName = livro.arquivo_url.split("/").pop()
    await supabase.storage.from("livros").remove([fileName])

    const { error: deleteError } = await supabase.from("livros").delete().eq("id", id)
    if (deleteError) throw deleteError

    res.json({ status: "ok" })
  } catch {
    res.status(500).json({ status: "erro", message: "Erro ao deletar livro." })
  }
})

// ── Anotações — exige JWT válido do usuário ──
app.get("/anotacoes", exigirUsuario, async (req, res) => {
  const { livro_url } = req.query
  if (!livro_url) return res.status(400).json({ status: "erro", message: "livro_url obrigatório." })

  try {
    const { data, error } = await supabase
      .from("anotacoes")
      .select("pagina, texto")
      .eq("user_id", req.userId)   // user_id vem do JWT verificado, não do cliente
      .eq("livro_url", livro_url)
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

  try {
    if (!texto || !String(texto).trim()) {
      const { error } = await supabase.from("anotacoes").delete()
        .eq("user_id", req.userId).eq("livro_url", livro_url).eq("pagina", pagina)
      if (error) throw error
    } else {
      const { error } = await supabase.from("anotacoes")
        .upsert({ user_id: req.userId, livro_url, pagina, texto: String(texto).slice(0,5000) },
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
      .eq("user_id", req.userId).eq("livro_url", livro_url)
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
      .upsert({ hl_id, user_id: req.userId, livro_url, pagina, cor, nota, img_data },
               { onConflict: "hl_id" })
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
      .select("pagina").eq("user_id", req.userId).eq("livro_url", livro_url).single()
    if (error && error.code !== "PGRST116") throw error
    res.json({ pagina: data?.pagina || 1 })
  } catch {
    res.status(500).json({ status: "erro", message: "Erro ao buscar progresso." })
  }
})

// ── 404 ──
app.use((req, res) => res.status(404).json({ status: "erro", message: "Rota não encontrada." }))

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`))
