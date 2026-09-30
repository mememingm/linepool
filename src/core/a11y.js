export class AccessibilityBridge {
  constructor(root, announce) {
    this.root = root
    this.announce = announce
  }

  reset(title, summary) {
    this.root.replaceChildren()
    const heading = document.createElement('h1')
    heading.textContent = title
    const description = document.createElement('p')
    description.textContent = summary
    this.root.append(heading, description)
  }

  addButton(label, onClick) {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = label
    button.addEventListener('focus', () => this.announce(`键盘焦点：${label}`))
    button.addEventListener('click', onClick)
    this.root.append(button)
    return button
  }

  addInput(labelText, value, onInput) {
    const label = document.createElement('label')
    label.textContent = labelText
    const input = document.createElement('input')
    input.type = 'text'
    input.value = value
    input.setAttribute('aria-label', labelText)
    input.addEventListener('focus', () => this.announce(`正在输入：${labelText}`))
    input.addEventListener('input', (event) => onInput(event.target.value))
    label.append(input)
    this.root.append(label)
    return input
  }
}
