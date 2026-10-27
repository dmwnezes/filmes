# Filmes

App de recomendação de filmes. Swipe para gostei/não gostei, busca, filmes semelhantes, listas "Ver depois" e "Já vi", e importação opcional do Letterboxd.

## Como rodar

1. Copie `config.example.js` para `config.js` e coloque sua chave do TMDB. `config.js` está no `.gitignore` e nunca vai para o repositório.
2. Abra `index.html` no navegador, ou sirva a pasta com qualquer servidor estático (ex.: `npx serve .`).

## Publicação (GitHub Pages)

O workflow `.github/workflows/pages.yml` publica a cada push na `main`. Ele gera `config.js` a partir do secret `TMDB_KEY` do repositório (Settings → Secrets and variables → Actions). A chave fica visível no site publicado, como em qualquer app TMDB só de front-end, mas não fica no código.

## Arquivos

- `index.html`: telas (Descobrir, Buscar, Listas) e modal de detalhes.
- `app.js`: lógica, chamadas ao TMDB, swipe, listas e importação do Letterboxd.
- `style.css`: visual.
- `config.example.js`: modelo do `config.js` (chave da API do TMDB, `TMDB_KEY`).

## Recomendação

- Filmes marcados como "gostei" (até 5 mais recentes) puxam recomendações e similares do TMDB.
- Candidatos que aparecem em mais de uma fonte sobem na lista.
- Filmes já vistos ou marcados não voltam. Sem histórico, o app mostra populares.

## Importar do Letterboxd (opcional)

Letterboxd → Settings → Data → Export. Extraia o zip e envie `watched.csv`, `ratings.csv` e/ou `watchlist.csv`.

- Nota >= 3,5 vira "gostei"; nota <= 2 vira "não gostei"; sem nota só marca como "já vi".
- Reimportar substitui o que veio do Letterboxd: o que saiu do export some das listas. Marcações feitas manualmente no app são preservadas.
- Um site não consegue observar uma pasta. "Atualizar sozinho" aqui significa: ao reimportar, tudo se recalcula.

## Dados

Tudo fica no `localStorage` do navegador. Não há conta nem servidor.

## APK (Android)

A pasta `android/` é um app WebView que abre https://dmwnezes.com/filmes/. O workflow `.github/workflows/apk.yml` compila e publica o APK nas Releases quando algo em `android/` muda (ou manualmente em Actions → Gerar APK).

Download da versão mais recente: https://github.com/dmwnezes/filmes/releases/latest/download/filmes.apk

Mudanças no site (`index.html`, `app.js`, `style.css`) aparecem no app sem reinstalar.

## Como o Descobrir escolhe

- Perfil feito do seu histórico: curtidos (peso 1), "não gostei" (peso -1) e vistos sem nota, como os do Letterboxd (peso 0,3), somados por gênero.
- Sementes: as 5 curtidas mais recentes mais 3 antigas sorteadas. Com poucas curtidas, entram filmes vistos.
- Candidatos vêm das recomendações e dos semelhantes do TMDB de cada semente. Semelhantes só contam se dividirem um gênero com a semente. Recomendações de filmes que você não gostou derrubam a nota.
- A nota final soma a força das sementes, a afinidade de gênero e a avaliação do filme. Cada cartão mostra o motivo.
- Esgotou? Busca os mais bem avaliados dos seus 2 gêneros favoritos, sem os gêneros que você rejeita. Sem histórico nenhum, mostra os populares.
