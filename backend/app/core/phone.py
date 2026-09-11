"""Equivalencia de números de WhatsApp argentinos (+54 vs +549).

WhatsApp identifica a los celulares argentinos con el prefijo +549 (el "9"
de móvil), pero el mismo número suele cargarse a mano como +54 sin el 9 —
en la base conviven ambas formas del mismo teléfono. Comparar por igualdad
exacta hace que el webhook no reconozca al emisor, o que los chequeos de
colisión dejen pasar un duplicado "distinto" que en la práctica es el mismo
número.

La equivalencia se resuelve en los LOOKUPS (`IN (variantes)`) y no
reescribiendo lo almacenado: migrar datos existentes podría chocar con los
unique constraints por tenant si ya conviven ambas formas.
"""


def wa_number_variants(number: str) -> list[str]:
    """Devuelve las formas equivalentes de `number` para comparar en BD.

    Solo genera variantes para celulares argentinos en E.164:
      - "+549" + 10 dígitos  →  también "+54" + los mismos 10 dígitos
      - "+54"  + 10 dígitos (sin el 9 de móvil) → también "+549" + dígitos
    Cualquier otro formato (otros países, largos raros, vacío) vuelve tal
    cual, en una lista de un elemento.
    """
    if not number:
        return [number]
    if number.startswith("+549") and len(number) == 14 and number[1:].isdigit():
        return [number, "+54" + number[4:]]
    if (
        number.startswith("+54")
        and not number.startswith("+549")
        and len(number) == 13
        and number[1:].isdigit()
    ):
        return [number, "+549" + number[3:]]
    return [number]
