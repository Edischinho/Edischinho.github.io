const express = require("express")
const multer = require("multer")
const fs = require("fs")
const cors = require("cors")
const { createClient } = require("@supabase/supabase-js")

const app = express()

app.use(cors())
app.use(express.json())

// ✅ Credenciais Supabase diretas (para Render, configure como env vars)
const SUPABASE_URL = process.env.SUPABASE_URL || "https://iwggwgepwbrvmmrgsrvr.supabase.co"
const SUPABASE_KEY = process.env.SUPABASE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml3Z2d3Z2Vwd2Jydm1tcmdzcnZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1Mzc4ODcsImV4cCI6MjA4OTExMzg4N30.BFaHUNavW7VOApg35r01SHsfjgYKUnhlT7YSADF9H6U"

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// ✅ Criar pasta temp se não existir
if (!fs.existsSync("temp")) fs.mkdirSync("temp")

// ✅ livros.json como fallback local
const livrosFile = "livros.json"
if (!fs.existsSync(livrosFile)) fs.writeFileSync(livrosFile, "[]")

// Credenciais admin
const ADMIN_USER = "admin"
const ADMIN_PASS = "1234"

// Multer: upload temporário em disco
const upload = multer({ dest: "temp/" })

// ─── ROTAS ────────────────────────────────────────────────

// Rota teste
app.get("/", (req, res) => {
  res.json({ status: "API funcionando" })
})

// ✅ Login — espera { user, password }
app.post("/login", (req, res) => {
  const { user, password } = req.body
  if (user === ADMIN_USER && password === ADMIN_PASS) {
    res.json({ status: "ok" })
  } else {
    res.status(401).json({ status: "erro", message: "Credenciais inválidas" })
  }
})

// ✅ Listar livros — lê do Supabase (fonte única de verdade)
app.get("/livros", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("livros")
      .select("*")
      .order("id", { ascending: false })

    if (error) throw error
    res.json(data)
  } catch (err) {
    console.error("Erro ao listar livros:", err.message)
    // fallback para JSON local se Supabase falhar
    const livros = JSON.parse(fs.readFileSync(livrosFile))
    res.json(livros)
  }
})

// ✅ Adicionar livro — recebe multipart, sobe para Storage, salva metadados na tabela
app.post("/addLivro", upload.single("arquivo"), async (req, res) => {
  try {
    const { titulo, autor = "", descricao = "" } = req.body

    if (!req.file) {
      return res.status(400).json({ status: "erro", message: "Nenhum arquivo enviado" })
    }
    if (!titulo) {
      return res.status(400).json({ status: "erro", message: "Título obrigatório" })
    }

    const filePath = req.file.path
    const ext = req.file.originalname.split(".").pop()
    const fileName = `${Date.now()}-${titulo.replace(/\s+/g, "_")}.${ext}`
    const fileBuffer = fs.readFileSync(filePath)

    // 1. Upload para Supabase Storage (bucket "livros")
    const { error: uploadError } = await supabase.storage
      .from("livros")
      .upload(fileName, fileBuffer, {
        contentType: req.file.mimetype,
        upsert: false
      })

    if (uploadError) throw uploadError

    // 2. Gerar URL pública permanente
    const { data: urlData } = supabase.storage
      .from("livros")
      .getPublicUrl(fileName)

    const publicUrl = urlData.publicUrl

    // 3. Salvar metadados na tabela "livros" do Supabase
    const { error: dbError } = await supabase
      .from("livros")
      .insert([{ titulo, autor, descricao, arquivo_url: publicUrl }])

    if (dbError) throw dbError

    // 4. Remover arquivo temporário
    fs.unlinkSync(filePath)

    res.json({ status: "ok", url: publicUrl })
  } catch (err) {
    console.error("Erro ao adicionar livro:", err.message)
    // limpar temp em caso de erro
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path)
    }
    res.status(500).json({ status: "erro", message: err.message })
  }
})

// ✅ Deletar livro
app.delete("/livros/:id", async (req, res) => {
  try {
    const { id } = req.params

    // Buscar o livro para saber o nome do arquivo
    const { data: livro, error: fetchError } = await supabase
      .from("livros")
      .select("arquivo_url")
      .eq("id", id)
      .single()

    if (fetchError) throw fetchError

    // Extrair nome do arquivo da URL
    const parts = livro.arquivo_url.split("/")
    const fileName = parts[parts.length - 1]

    // Remover do Storage
    await supabase.storage.from("livros").remove([fileName])

    // Remover da tabela
    const { error: deleteError } = await supabase
      .from("livros")
      .delete()
      .eq("id", id)

    if (deleteError) throw deleteError

    res.json({ status: "ok" })
  } catch (err) {
    console.error("Erro ao deletar livro:", err.message)
    res.status(500).json({ status: "erro", message: err.message })
  }
})

// ─── INICIAR ──────────────────────────────────────────────
const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`))
