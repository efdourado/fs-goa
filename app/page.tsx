const ratingOptions = ["0", "0,5", "1", "1,5", "2", "2,5", "3", "3,5", "4", "4,5", "5"];

const members = [
  { initials: "ED", name: "Eduardo", tone: "violet" },
  { initials: "AN", name: "Ana", tone: "coral" },
  { initials: "JM", name: "João", tone: "mint" },
  { initials: "MA", name: "Maria", tone: "sand" },
];

export default function Home() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Goa, página inicial">
          <span className="brand-mark" aria-hidden="true">g</span>
          <span className="brand-name">goa</span>
        </a>

        <nav className="desktop-nav" aria-label="Navegação principal">
          <a className="nav-link nav-link-active" href="#today">Hoje</a>
          <a className="nav-link" href="#history">Histórico</a>
          <a className="nav-link" href="#group">Grupo</a>
        </nav>

        <button className="profile-button" type="button" aria-label="Abrir perfil de Eduardo">
          <span className="profile-copy">
            <strong>Eduardo</strong>
            <span>participante</span>
          </span>
          <span className="avatar avatar-violet" aria-hidden="true">ED</span>
        </button>
      </header>

      <main id="top" className="page-content">
        <section className="page-intro" aria-labelledby="page-title">
          <div>
            <p className="eyebrow">Sexta-feira, 28 de agosto</p>
            <h1 id="page-title">Boa noite, Eduardo.</h1>
          </div>
          <a className="group-chip" href="#group">
            <span className="group-dot" aria-hidden="true" />
            Clube do Sofá
            <span className="group-count">4 pessoas</span>
          </a>
        </section>

        <section className="challenge-hero" aria-labelledby="challenge-title">
          <div className="hero-content">
            <div className="hero-topline">
              <span className="status-pill"><span aria-hidden="true" /> Desafio ativo</span>
              <span className="date-range">22 jan — 18 mar</span>
            </div>

            <div className="hero-heading">
              <p>Cine · edição 1</p>
              <h2 id="challenge-title">30 filmes.<br />Oito semanas juntos.</h2>
            </div>

            <div className="progress-block">
              <div className="progress-labels">
                <span><strong>18</strong> de 30 filmes</span>
                <span>60%</span>
              </div>
              <div
                className="progress-track"
                role="progressbar"
                aria-label="Progresso do desafio"
                aria-valuemin={0}
                aria-valuemax={30}
                aria-valuenow={18}
              >
                <span className="progress-value" />
              </div>
              <div className="hero-footer">
                <div className="avatar-stack" aria-label="Eduardo, Ana, João e Maria participam">
                  {members.map((member) => (
                    <span
                      className={`avatar avatar-${member.tone}`}
                      title={member.name}
                      key={member.name}
                    >
                      {member.initials}
                    </span>
                  ))}
                </div>
                <a href="#rules">Ver regras <span aria-hidden="true">↗</span></a>
              </div>
            </div>
          </div>

          <div className="hero-ticket" aria-hidden="true">
            <span className="ticket-kicker">filme</span>
            <strong>18</strong>
            <span className="ticket-total">/ 30</span>
            <div className="ticket-holes"><i /><i /><i /><i /><i /></div>
          </div>
        </section>

        <div id="today" className="content-grid">
          <section className="entry-card" aria-labelledby="entry-title">
            <div className="card-heading">
              <div>
                <p className="eyebrow">Seu registro de hoje</p>
                <h2 id="entry-title">Aftersun</h2>
              </div>
              <span className="deadline">Até domingo, 21h</span>
            </div>

            <div className="film-context">
              <span>Semana 5</span><i aria-hidden="true" />
              <span>Filme 18</span><i aria-hidden="true" />
              <span>2022 · 1h 42min</span>
            </div>

            <form className="entry-form">
              <fieldset className="rating-fieldset">
                <legend>Qual é a sua nota?</legend>
                <p>De 0 a 5, em intervalos de 0,5.</p>
                <div className="rating-scale">
                  {ratingOptions.map((rating) => {
                    const selected = rating === "4,5";
                    return (
                      <button
                        className={selected ? "rating-button rating-selected" : "rating-button"}
                        type="button"
                        aria-pressed={selected}
                        aria-label={`Nota ${rating}`}
                        key={rating}
                      >
                        {rating}
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <label className="comment-field">
                <span>Quer guardar uma impressão? <em>opcional</em></span>
                <textarea
                  rows={3}
                  placeholder="Uma cena, uma ideia, algo para lembrar..."
                  maxLength={280}
                />
              </label>

              <button className="primary-button" type="button">
                Salvar avaliação <span aria-hidden="true">→</span>
              </button>
            </form>
          </section>

          <aside className="side-column" aria-label="Resumo pessoal">
            <section className="rhythm-card" aria-labelledby="rhythm-title">
              <div className="card-heading compact">
                <div>
                  <p className="eyebrow">Seu ritmo</p>
                  <h2 id="rhythm-title">Você está em dia.</h2>
                </div>
                <span className="check-mark" aria-hidden="true">✓</span>
              </div>

              <div className="personal-progress">
                <span className="personal-progress-value">16</span>
                <span className="personal-progress-total">/ 30<br />assistidos</span>
              </div>

              <dl className="rhythm-stats">
                <div><dt>Sequência atual</dt><dd>3 semanas</dd></div>
                <div><dt>Média pessoal</dt><dd>4,1</dd></div>
              </dl>

              <div className="next-film">
                <span className="next-icon" aria-hidden="true">▶</span>
                <div>
                  <p>Próximo título</p>
                  <strong>Perfect Days</strong>
                  <span>libera segunda-feira</span>
                </div>
              </div>
            </section>

            <section id="history" className="history-card" aria-labelledby="history-title">
              <div className="history-heading">
                <h2 id="history-title">Seus últimos</h2>
                <a href="#history">Ver todos</a>
              </div>
              <ul>
                <li>
                  <span className="history-index">17</span>
                  <span className="history-film"><strong>Anatomia de uma Queda</strong><small>Semana 5</small></span>
                  <span className="history-score">4,0</span>
                </li>
                <li>
                  <span className="history-index">16</span>
                  <span className="history-film"><strong>Vidas Passadas</strong><small>Semana 4</small></span>
                  <span className="history-score">4,5</span>
                </li>
              </ul>
            </section>
          </aside>
        </div>

        <section id="rules" className="principle-note" aria-label="Princípio do produto">
          <span aria-hidden="true">✦</span>
          <p><strong>Você registra.</strong> O Goa organiza, calcula e guarda a história do grupo.</p>
        </section>
      </main>

      <nav className="mobile-nav" aria-label="Navegação mobile">
        <a className="mobile-nav-active" href="#today"><span aria-hidden="true">●</span>Hoje</a>
        <a href="#history"><span aria-hidden="true">◷</span>Histórico</a>
        <a href="#group"><span aria-hidden="true">◎</span>Grupo</a>
      </nav>
    </div>
  );
}
