const express = require("express")
const multer = require("multer")
const fs = require("fs")
const cors = require("cors")
const path = require("path")

const app = express()

// permitir acesso do frontend
app.use(cors())

// ler JSON
app.use(express.json())

// pasta uploads
const uploadDir = path.join(__dirname,"uploads")

if(!fs.existsSync(uploadDir)){
fs.mkdirSync(uploadDir)
}

// servir arquivos da pasta uploads
app.use("/uploads",express.static(uploadDir))

// criar livros.json se não existir
const livrosFile = path.join(__dirname,"livros.json")

if(!fs.existsSync(livrosFile)){
fs.writeFileSync(livrosFile,"[]")
}

// admin
const ADMIN_USER = "admin"
const ADMIN_PASS = "1234"

// configuração upload
const storage = multer.diskStorage({
destination:(req,file,cb)=>{
cb(null,uploadDir)
},
filename:(req,file,cb)=>{
cb(null,Date.now()+"-"+file.originalname)
}
})

const upload = multer({storage})

// rota teste
app.get("/",(req,res)=>{
res.json({status:"API funcionando"})
})

// login
app.post("/login",(req,res)=>{

const {user,password}=req.body

if(user===ADMIN_USER && password===ADMIN_PASS){
res.json({status:"ok"})
}else{
res.json({status:"erro"})
}

})

// listar livros
app.get("/livros",(req,res)=>{

let livros = JSON.parse(fs.readFileSync(livrosFile))

res.json(livros)

})

// adicionar livro
app.post("/addLivro",upload.single("capa"),(req,res)=>{

try{

let livros = JSON.parse(fs.readFileSync(livrosFile))

livros.push({
titulo:req.body.titulo,
capa:"uploads/"+req.file.filename
})

fs.writeFileSync(livrosFile,JSON.stringify(livros,null,2))

res.json({status:"ok"})

}catch(err){

console.error(err)

res.json({status:"erro"})

}

})

// porta do render
const PORT = process.env.PORT || 3000

app.listen(PORT,()=>{
console.log("Servidor rodando na porta "+PORT)
})
