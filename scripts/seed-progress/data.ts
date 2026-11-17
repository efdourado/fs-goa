import type { ChallengeField } from "../../app/goa/types";
import type { ProgressTracking } from "../../lib/progress-tracking";

const number = (key: string, label: string, unit = ""): ChallengeField => ({ key, label, type: "number", required: true, config: { min: 0, step: 0.1, unit } });
interface DemoRow { item?: string; values: Record<string, number> }
export interface ProgressDemo {
  title: string;
  description: string;
  session: boolean;
  fields: ChallengeField[];
  items?: string[];
  /** Field keys become the generated ids when saved. */
  performance: NonNullable<ProgressTracking["performance"]>;
  sessions: DemoRow[][];
}

export const PROGRESS_DEMOS: ProgressDemo[] = [
  {
    title: "Progresso · uma série",
    description: "Supino: mesma carga e mais repetições; depois menos carga e um novo recorde de repetições naquela carga. Cada medida aparece, mesmo quando o recorde global não muda.",
    session: true, fields: [number("weight", "Carga", "kg"), number("reps", "Repetições")], items: ["Supino", "Remada"],
    performance: { mode: "separate", fieldIds: ["weight", "reps"], rules: { reps: { direction: "higher", contextFieldId: "weight" } } },
    sessions: [[50, 8], [50, 10], [60, 6], [50, 12], [45, 15], [45, 18]].map(([weight, reps], i) => [
      { item: "Supino", values: { weight, reps } }, { item: "Remada", values: { weight: 30 + Math.floor(i / 2) * 5, reps: 10 + i % 2 } },
    ]),
  },
  {
    title: "Progresso · três séries",
    description: "Três séries de agachamento com cargas diferentes: histórico por número da série, fatores individuais e volume total da sessão. As linhas mudam de ordem para demonstrar que a identidade vem do campo Série.",
    session: true, fields: [number("set", "Série"), number("weight", "Carga", "kg"), number("reps", "Repetições")], items: ["Agachamento"],
    performance: { mode: "product", fieldIds: ["weight", "reps"], sessionAggregation: "sum", seriesFieldId: "set", rules: { reps: { direction: "higher", contextFieldId: "weight" } } },
    sessions: [
      [[1, 60, 8], [2, 55, 10], [3, 50, 12]],
      [[3, 50, 13], [1, 60, 9], [2, 55, 11]],
      [[2, 55, 12], [3, 50, 14], [1, 60, 10]],
    ].map((sets) => sets.map(([set, weight, reps]) => ({ item: "Agachamento", values: { set, weight, reps } }))),
  },
  {
    title: "Progresso · corrida",
    description: "Registros diários com distância, tempo e frequência cardíaca. Um percurso maior leva mais tempo; a comparação de tempo na mesma distância mostra a melhora sem misturar os percursos.",
    session: false, fields: [number("distance", "Distância", "km"), number("time", "Tempo", "min"), number("heart", "Frequência cardíaca", "bpm")],
    performance: { mode: "separate", fieldIds: ["distance", "time", "heart"], rules: { distance: { direction: "descriptive" }, time: { direction: "lower", contextFieldId: "distance" }, heart: { direction: "descriptive" } } },
    sessions: [[5, 32, 150], [5, 30, 148], [10, 65, 152], [10, 62, 150], [5, 29, 146]].map(([distance, time, heart]) => [{ values: { distance, time, heart } }]),
  },
  {
    title: "Progresso · estudos",
    description: "Sessões por matéria: mais acertos é melhor, menos erros é melhor e minutos são apenas contexto. Um tempo maior de estudo não vira automaticamente um recorde.",
    session: true, fields: [number("correct", "Acertos"), number("errors", "Erros"), number("minutes", "Tempo de estudo", "min")], items: ["Matemática", "Português"],
    performance: { mode: "separate", fieldIds: ["correct", "errors", "minutes"], rules: { correct: { direction: "higher" }, errors: { direction: "lower" }, minutes: { direction: "descriptive" } } },
    sessions: [[12, 8, 45], [15, 5, 40], [18, 2, 50], [16, 4, 35]].map(([correct, errors, minutes], i) => [
      { item: "Matemática", values: { correct, errors, minutes } }, { item: "Português", values: { correct: 14 + i, errors: 6 - i, minutes: 30 + i * 5 } },
    ]),
  },
  {
    title: "Progresso · jardim",
    description: "Um valor desejado em vez do maior número: umidade perto de 60%. Chega à meta e depois se afasta; o resultado atual e o melhor resultado continuam distintos. Temperatura é descritiva; água começa em zero.",
    session: false, fields: [number("moisture", "Umidade do solo", "%"), number("temperature", "Temperatura", "°C"), number("water", "Água", "ml")],
    performance: { mode: "separate", fieldIds: ["moisture", "temperature", "water"], rules: { moisture: { direction: "target", target: 60 }, temperature: { direction: "descriptive" }, water: { direction: "descriptive" } } },
    sessions: [[35, 25, 0], [50, 27, 100], [60, 24, 150], [72, 28, 200], [64, 26, 120]].map(([moisture, temperature, water]) => [{ values: { moisture, temperature, water } }]),
  },
];
