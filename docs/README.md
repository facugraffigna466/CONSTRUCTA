# Documentación de CONSTRUCTA

Índice de qué hay y dónde. La **bitácora de desarrollo** (`documentacion.md`) es la
entrada principal: registra sesión por sesión qué se hizo y por qué.

| Carpeta | Qué contiene |
|---|---|
| [`documentacion.md`](documentacion.md) | **Bitácora de desarrollo.** Se actualiza después de cada sesión o módulo. |
| [`ipi/`](ipi/) | Entregable académico: el Informe de Proyecto Integrador (`.md`), su export a `.docx` y el script que lo genera. |
| [`auditoria/`](auditoria/) | Auditorías del sistema: once por módulo (`01` a `11`) más cuatro transversales (general, UX, flujo de alta y la consolidada). |
| [`analisis/`](analisis/) | Los ocho análisis técnicos por módulo que alimentaron la auditoría consolidada. |
| [`features/`](features/) | Documentación de funcionalidades concretas: cómo quedó, qué se decidió y cómo se probó. Incluye `samples/` con ejemplos abribles en el navegador. |
| [`roles-redesign/`](roles-redesign/) | El rediseño de roles y multi-tenant, fase por fase (0 a 6). |
| [`estado/`](estado/) | Fotos del estado del proyecto: alcance de la defensa, estado general, handoff de remediación y propuestas abiertas. |
| [`referencia/`](referencia/) | Material de consulta: schema de la base, casos de prueba manuales y skills. |
| [`diagramas/`](diagramas/) | Diagramas (SVG + PNG) y capturas que se embeben en el IPI. |

## Cómo regenerar el IPI en `.docx`

Tras editar `ipi/IPI-CONSTRUCTA.md`:

```bash
backend/.venv/bin/python docs/ipi/build_ipi_docx.py
```

Embebe los diagramas de `diagramas/` en las Figuras 1, 6 y 7. Los SVG se rasterizan a PNG con:

```bash
qlmanage -t -s 1600 -o docs/diagramas docs/diagramas/<archivo>.svg
```
