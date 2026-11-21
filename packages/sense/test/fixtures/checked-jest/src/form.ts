/** What a form sends: a draft is kept, and only a published form is sent. */
export function submit(form: { readonly title: string; readonly draft: boolean }): { readonly title: string; readonly draft: boolean } {
  return { title: form.title.trim(), draft: form.draft };
}
