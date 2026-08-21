"""
Regenera data.json a partir del Excel de costos de JetMach.
Uso:
    python3 actualizar_datos.py "Costos_de_Handling_JETMACH_v2.xlsx"

Luego sube data.json al repo de GitHub Pages (reemplazando el archivo
existente) y el dashboard reflejará los datos nuevos automáticamente
la próxima vez que alguien lo abra.
"""
import sys
import json
import pandas as pd

def main(path):
    df = pd.read_excel(path, sheet_name='Costos', header=1)

    cols = {
        'FECHA': 'fecha',
        'MATRÍCULA': 'matricula',
        'TIPO DE EVENTO': 'tipo_evento',
        'CLIENTE': 'cliente',
        'SUBTOTAL FACTURA\n(cobrado al cliente)': 'facturado',
        'TOTAL COSTO\n(nuestro costo)': 'costo',
        'MARGEN\n($)': 'margen',
        'MARGEN\n(%)': 'margen_pct',
    }
    df2 = df[list(cols.keys())].rename(columns=cols)
    df2 = df2.dropna(subset=['fecha'])
    df2['fecha'] = pd.to_datetime(df2['fecha'], errors='coerce')
    df2 = df2.dropna(subset=['fecha'])
    df2['year'] = df2['fecha'].dt.year
    df2['month'] = df2['fecha'].dt.month
    df2['fecha'] = df2['fecha'].dt.strftime('%Y-%m-%d')

    for c in ['facturado', 'costo', 'margen']:
        df2[c] = pd.to_numeric(df2[c], errors='coerce').fillna(0)
    df2['margen_pct'] = pd.to_numeric(df2['margen_pct'], errors='coerce').fillna(0)
    df2['tipo_evento'] = df2['tipo_evento'].fillna('SIN CLASIFICAR')
    df2['cliente'] = df2['cliente'].fillna('SIN CLIENTE')

    records = df2.to_dict(orient='records')
    with open('data.json', 'w', encoding='utf-8') as f:
        json.dump(records, f, ensure_ascii=False)

    print(f'data.json actualizado con {len(records)} eventos.')

if __name__ == '__main__':
    if len(sys.argv) != 2:
        print('Uso: python3 actualizar_datos.py archivo.xlsx')
        sys.exit(1)
    main(sys.argv[1])
