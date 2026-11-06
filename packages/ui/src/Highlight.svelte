<script lang="ts">
  interface Props {
    text: string;
    /** Matches are shown in bold; case and accents are ignored. */
    query?: string;
  }

  let { text, query = '' }: Props = $props();

  /** Lower case without accents, keeping one character per character. */
  const fold = (value: string) =>
    [...value].map((char) => char.normalize('NFD').charAt(0).toLowerCase()).join('');

  const parts = $derived.by(() => {
    const needle = fold(query.trim());
    if (!needle) return [{ text, match: false }];
    const haystack = fold(text);
    const chars = [...text];
    const result: { text: string; match: boolean }[] = [];
    let from = 0;
    let at = haystack.indexOf(needle);
    while (at !== -1) {
      if (at > from) result.push({ text: chars.slice(from, at).join(''), match: false });
      result.push({ text: chars.slice(at, at + needle.length).join(''), match: true });
      from = at + needle.length;
      at = haystack.indexOf(needle, from);
    }
    if (from < chars.length) result.push({ text: chars.slice(from).join(''), match: false });
    return result;
  });
</script>

{#each parts as part, index (index)}{#if part.match}<b>{part.text}</b>{:else}{part.text}{/if}{/each}

<style>
  b {
    font-weight: 700;
  }
</style>
