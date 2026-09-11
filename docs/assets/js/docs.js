const article = document.querySelector('.page-content')
const headings = [...document.querySelectorAll('.page-content h2[id]')]
if (article && headings.length > 5 && !headings.some(heading => /table of contents/i.test(heading.textContent))) {
  const contents = document.createElement('details')
  contents.className = 'page-outline'
  const summary = document.createElement('summary')
  summary.textContent = 'On this page'
  const list = document.createElement('ul')
  for (const heading of headings) {
    const item = document.createElement('li')
    const link = document.createElement('a')
    link.href = '#' + heading.id
    link.textContent = heading.textContent
    item.append(link)
    list.append(item)
  }
  contents.append(summary, list)
  const title = article.querySelector('h1')
  if (title) title.after(contents)
}

const chapterMenu = document.querySelector('.chapter-menu')
if (chapterMenu && window.matchMedia('(max-width: 960px)').matches) chapterMenu.open = false

for (const table of document.querySelectorAll('.page-content table')) {
  const scroll = document.createElement('div')
  scroll.className = 'table-scroll'
  scroll.tabIndex = 0
  scroll.setAttribute('role', 'region')
  scroll.setAttribute('aria-label', 'Scrollable table')
  table.before(scroll)
  scroll.append(table)
}

if (navigator.clipboard) {
  for (const pre of document.querySelectorAll('pre')) {
    const code = pre.querySelector('code')
    if (!code) continue
    const wrapper = document.createElement('div')
    wrapper.className = 'code-block'
    pre.before(wrapper)
    wrapper.append(pre)
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'copy-button'
    button.textContent = 'Copy'
    button.setAttribute('aria-label', 'Copy code to clipboard')
    button.setAttribute('aria-live', 'polite')
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(code.textContent)
        button.textContent = 'Copied'
      } catch {
        button.textContent = 'Select and copy manually'
      }
      setTimeout(() => { button.textContent = 'Copy' }, 2500)
    })
    wrapper.prepend(button)
  }
}
