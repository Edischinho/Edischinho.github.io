const grid=document.getElementById("grid")
const search=document.getElementById("search")

let livros=[]

async function carregar(){

let res=await fetch("https://edischinho-github-io.onrender.com/livros")

livros=await res.json()

mostrar(livros)

}

function mostrar(lista){

grid.innerHTML=""

lista.forEach(l=>{

let div=document.createElement("div")
div.className="livro"

div.innerHTML=`
<img src="SEU_BACKEND_URL/${l.capa}">
<p>${l.titulo}</p>
`

grid.appendChild(div)

})

}

search.addEventListener("input",()=>{

let f=search.value.toLowerCase()

let filtrados=livros.filter(l=>l.titulo.toLowerCase().includes(f))

mostrar(filtrados)

})

carregar()
const grid = document.getElementById("grid")
const search = document.getElementById("search")

let livros=[]

async function carregar(){

let res = await fetch("https://edischinho-github-io.onrender.com/livros")

livros = await res.json()

mostrar(livros)

}

function mostrar(lista){

grid.innerHTML=""

lista.forEach(livro=>{

let div = document.createElement("div")

div.className="livro"

div.innerHTML=`

<img src="http://localhost:3000/${livro.capa}">
<p>${livro.titulo}</p>

`

grid.appendChild(div)

})

}

search.addEventListener("input",()=>{

let filtro = search.value.toLowerCase()

let filtrados = livros.filter(l=>l.titulo.toLowerCase().includes(filtro))

mostrar(filtrados)

})

carregar()
