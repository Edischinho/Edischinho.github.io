const express = require("express")
const multer = require("multer")
const fs = require("fs")
const cors = require("cors")
const path = require("path")

const app = express()

app.use(cors({
origin:"https://strongholdlibrary.netlify.app"
}))

app.use(express.json())

const uploadDir = path.join(__dirname,"uploads")

if(!fs.existsSync(uploadDir)){
fs.mkdirSync(uploadDir)
}

app.use("/uploads",express.static(uploadDir))

const livrosFile = path.join(__dirname,"livros.json")

if(!fs.existsSync(livrosFile)){
fs.writeFileSync(livrosFile,"[]")
}

const ADMIN_USER="admin"
const ADMIN_PASS="1234"

const storage = multer.diskStorage({

destination:(req,file,cb)=>{
cb(null,uploadDir)
},

filename:(req,file,cb)=>{
cb(null,Date.now()+"-"+file.originalname)
}

})

const upload = multer({storage})

app.get("/",(req,res)=>{
res.json({status:"API funcionando"})
})

app.post("/login",(req,res)=>{

const {user,password}=req.body

if(user===ADMIN_USER && password===ADMIN_PASS){
res.json({status:"ok"})
}else{
res.json({status:"erro"})
}

})

app.get("/livros",(req,res)=>{

let livros=JSON.parse(fs.readFileSync(livrosFile))

res.json(livros)

})

app.post("/addLivro",upload.fields([
{name:"capa"},
{name:"pdf"}
]),(req,res)=>{

try{

let livros=JSON.parse(fs.readFileSync(livrosFile))

let capa=req.files.capa[0].filename
let pdf=req.files.pdf[0].filename

let novoLivro={
titulo:req.body.titulo,
capa:"uploads/"+capa,
pdf:"uploads/"+pdf
}

livros.push(novoLivro)

fs.writeFileSync(livrosFile,JSON.stringify(livros,null,2))

res.json({status:"ok"})

}catch(err){

console.log(err)

res.json({status:"erro"})

}

})

const PORT=process.env.PORT||3000

app.listen(PORT,()=>{
console.log("Servidor rodando")
})
