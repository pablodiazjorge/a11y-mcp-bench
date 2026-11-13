# a11y-mcp-bench

¿Ayuda un servidor MCP de accesibilidad a que un agente de programación arregle defectos WCAG en una aplicación Angular, y a qué coste?

Este repositorio tendrá un banco de pruebas que responda a esa pregunta y uno de los servidores MCP que mide. Un servidor MCP (Model Context Protocol) da a un agente de programación herramientas adicionales que puede usar. WCAG (Web Content Accessibility Guidelines) es el estándar que define qué es un defecto de accesibilidad.

[English version](README.md)

## Estado

En sus inicios. Todavía no hay servidor ni banco de pruebas que ejecutar: el repositorio tiene las herramientas de desarrollo, la integración continua (CI) y las reglas del proyecto.

## Qué medirá

Un agente de programación recibe una aplicación Angular con un defecto de accesibilidad introducido a propósito (un defecto sembrado) y se le pide que lo arregle. Cada tarea se ejecuta en condiciones que se diferencian en una sola cosa: qué servidor MCP de accesibilidad tiene el agente, si tiene alguno. El primer estudio prevé tres: sin servidor, con el servidor de este proyecto y con un servidor de terceros ya existente.

- **Resultado:** una tarea está resuelta cuando pasa el test de su defecto (que el agente no ve), siguen pasando los tests de regresión y la aplicación sigue compilando. Deciden los tests, no un modelo de lenguaje.
- **Coste:** tokens, turnos y tiempo de cada ejecución.
- **Método:** las tareas, los criterios de corrección y el análisis se congelan y se publican antes de la primera ejecución del estudio (un prerregistro), y el informe se publica sea cual sea el resultado. El [ADR 0002](docs/adr/0002-methodology.md) (un registro de decisión de arquitectura) explica por qué.

## Hoja de ruta

| Paso                     | Contenido                                                                                                             | Issue                                                           |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Cimientos                | Herramientas, CI, reglas y las primeras decisiones                                                                    | [#3](https://github.com/pablodiazjorge/a11y-mcp-bench/issues/3) |
| Servidor, parte 1        | Esqueleto, política de URL (qué páginas puede abrir el servidor) y auditoría de página                                | [#4](https://github.com/pablodiazjorge/a11y-mcp-bench/issues/4) |
| Servidor, parte 2        | Comprobaciones de teclado y foco; publicación de la v0.1.0                                                            | [#5](https://github.com/pablodiazjorge/a11y-mcp-bench/issues/5) |
| Aplicación de referencia | Una tienda accesible en Angular                                                                                       | [#6](https://github.com/pablodiazjorge/a11y-mcp-bench/issues/6) |
| Defectos                 | Estadística, simulación de potencia (cuántas tareas hacen falta para detectar un efecto) y defectos sembrados         | [#7](https://github.com/pablodiazjorge/a11y-mcp-bench/issues/7) |
| Arnés                    | El arnés (el programa que ejecuta al agente en cada tarea y guarda el resultado) y una prueba piloto a pequeña escala | [#8](https://github.com/pablodiazjorge/a11y-mcp-bench/issues/8) |
| Estudio 1                | Prerregistro, ejecuciones e informe; publicación de la v1.0.0                                                         | [#9](https://github.com/pablodiazjorge/a11y-mcp-bench/issues/9) |

Las partes y cómo dependen unas de otras están en [docs/architecture.md](docs/architecture.md).

## Qué no es

- **No es un auditor completo de WCAG.** Las comprobaciones automáticas solo encuentran una parte de los problemas de accesibilidad de una página.
- **Solo Angular.** La aplicación de referencia y los defectos son código Angular.
- **Solo Claude Code hasta la v1.0.0.** Otros agentes pueden llegar después.
- **Solo páginas locales.** El servidor audita páginas servidas desde la misma máquina.

El [ADR 0001](docs/adr/0001-scope-and-non-goals.md) da los motivos y explica por qué el proyecto tiene un servidor propio cuando ya existen otros.

## Trabajo previo

Comprobado el 12 de noviembre de 2026.

**Ya existen servidores MCP que auditan la accesibilidad.** La mayoría usa axe-core, una biblioteca de comprobaciones automáticas de accesibilidad. La última fila es el servidor del propio CLI de Angular, que no tiene ninguna:

| Servidor                                                                                                        | Qué ofrece                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Deque axe MCP Server](https://docs.deque.com/devtools-server/4.0.0/en/axe-mcp-server)                          | `analyze` ejecuta axe en un navegador real. Sus indicaciones para corregir los problemas y sus pruebas guiadas de teclado son funciones de pago                                                                                                              |
| [mcp-accessibility-scanner](https://github.com/JustasMonkev/mcp-accessibility-scanner)                          | axe-core con Playwright. Su herramienta `audit_keyboard` recorre la página con el tabulador e informa de la visibilidad del foco, de posibles trampas de foco y de heurísticas para los criterios WCAG 2.4.11 (foco no oculto) y 2.5.8 (tamaño del objetivo) |
| [a11y-mcp](https://github.com/priyankark/a11y-mcp), [a11y-mcp-server](https://github.com/ronantakizawa/a11ymcp) | axe-core con Puppeteer                                                                                                                                                                                                                                       |
| [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp)                                    | `lighthouse_audit`, con una categoría de accesibilidad                                                                                                                                                                                                       |
| [Servidor MCP del CLI de Angular](https://angular.dev/ai/mcp)                                                   | Nueve herramientas documentadas, ninguna de accesibilidad                                                                                                                                                                                                    |

**Un proveedor ya ha publicado esta comparación.** [AccessLint](https://dev.to/cameron-accesslint/accessibility-tooling-for-agentic-coding-loops-5b1h) publicó los resultados de un agente con y sin su propio servidor MCP en 25 casos de prueba HTML. El agente arregló el 99,5 % de las infracciones con el servidor y el 93,5 % sin él. Si sin ayuda ya arregla el 93,5 %, queda poco margen para mostrar una mejora.

**Investigación sobre modelos de lenguaje y accesibilidad:**

- [LLM Based Web Accessibility Repair](https://arxiv.org/abs/2605.27716) (Oyelayo y otros, 2026): menos del 26 % de los casos quedaron resueltos del todo, e iterar subió el coste sin mejorar el resultado. Los autores recomiendan combinar el modelo con validación por reglas.
- [A11YRepair](https://arxiv.org/abs/2606.21926) (Huang y otros, 2026): un método de reparación evaluado en A11YBench, 60 proyectos web reales.
- [A11y-Bench](https://repositum.tuwien.at/handle/20.500.12708/224566) (Tschoner, 2025): 51 arreglos reales de accesibilidad de repositorios de código abierto; con tres modelos de pesos abiertos (descargables por cualquiera), solo 1 quedó resuelto del todo.
- [a11y-llm-eval](https://github.com/microsoft/a11y-llm-eval) (Microsoft): mide lo accesible que es el HTML que genera un modelo.

**Qué añadirá este proyecto:** la misma comparación con y sin servidor, con el método fijado y publicado antes de las ejecuciones, sobre el repositorio de una aplicación Angular en lugar de casos de prueba HTML y con defectos elegidos, tras una prueba piloto, para que el agente no los arregle ya casi todos por su cuenta. Como en el caso de AccessLint, el autor escribe también uno de los servidores que mide, así que el método está diseñado para que haga falta fiarse de él lo menos posible: véase el [ADR 0002](docs/adr/0002-methodology.md).

## Desarrollo

Hacen falta Node 26 (o Node 24 a partir de la 24.15) y npm 11.

```bash
npm ci
npm run ci
```

Las reglas de un cambio están en [AGENTS.md](AGENTS.md), y la forma de proponer uno, en [CONTRIBUTING.md](CONTRIBUTING.md). Para avisar de una vulnerabilidad, véase [SECURITY.md](SECURITY.md).

## Cómo se construye

El autor decide el alcance y la arquitectura, y deja escrita cada decisión difícil de deshacer como un ADR en [docs/adr/](docs/adr/). Los agentes de programación (Claude Code) escriben la mayor parte del código y de los documentos, siguiendo las reglas de [AGENTS.md](AGENTS.md).

Cada cambio que escribe un agente pasa la puerta local (`npm run ci`) y la CI, y lo revisa otro agente que no lo ha escrito. El autor lee cada diff, hace el commit y fusiona la pull request.

## Limitaciones

- Todavía no hay ningún resultado, así que nada de lo que hay aquí dice si un servidor ayuda.
- Un banco de pruebas con una sola aplicación, un solo agente y defectos sembrados dice poco de otros frameworks, de otros agentes o de los defectos que tienen los proyectos reales.
- La comprobación de datos personales se basa en patrones que pueden dejar pasar algún caso, y la que impide versiones de dependencias publicadas hace menos de siete días no detecta una dependencia `file:` a una carpeta. `AGENTS.md` y las pull requests que añadieron cada comprobación describen sus huecos conocidos.

## Licencia

El código, los tests, las definiciones de tareas y la configuración están bajo la [licencia MIT](LICENSE). Los documentos y los resultados publicados del banco de pruebas, bajo [CC BY 4.0](LICENSE-CC-BY-4.0).
