<script lang="ts">
  export interface PasswordStrength {
    /** 0 (none) to 4 (strong), as computed by the caller. */
    level: 0 | 1 | 2 | 3 | 4;
    /** Too common: the form must not accept it. */
    blocked: boolean;
    /** What to tell the person, for example "Muy común: elige otra". */
    message: string;
  }

  interface Props {
    /** null while the field is empty. The meter computes nothing. */
    strength: PasswordStrength | null;
    /** Use it as aria-describedby on the password field. */
    id?: string;
  }

  let { strength, id }: Props = $props();
</script>

<div class="meter" class:blocked={strength?.blocked}>
  <div class="bars" aria-hidden="true">
    {#each [1, 2, 3, 4] as step (step)}
      <span class="bar" class:on={!!strength && strength.level >= step}></span>
    {/each}
  </div>
  <p {id} class="msg" aria-live="polite">{strength?.message ?? ''}</p>
</div>

<style>
  .meter {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .bars {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 4px;
  }
  .bar {
    height: 4px;
    border-radius: 2px;
    background: var(--line);
  }
  .bar.on {
    background: var(--accent-text);
  }
  .blocked .bar.on {
    background: var(--danger);
  }
  .msg {
    min-height: 1.4em;
    margin: 0;
    color: var(--muted);
    font-size: var(--fs-help);
    line-height: 1.4;
  }
  .blocked .msg {
    color: var(--danger);
  }
</style>
