-- Reseed res_city with Italian provinces only (name = province, comune = provincia)
-- Each province mapped to the geographically closest territorial group.
-- Clears all existing city data first.

-- Null out FK references on partners before deleting cities
UPDATE res_partner SET city_id = NULL WHERE city_id IS NOT NULL;

DELETE FROM res_city;

INSERT INTO res_city (id, name, province, province_code, region, category_id, created_at, updated_at)
SELECT
  gen_random_uuid(),
  p.nome,
  p.nome,
  p.code,
  p.regione,
  (SELECT id FROM res_partner_category WHERE name = p.gruppo AND category_type = 'territorial' LIMIT 1),
  now(),
  now()
FROM (VALUES
  -- Valle d'Aosta
  ('Aosta',                   'AO', 'Valle d''Aosta',        'Varese'),
  -- Piemonte
  ('Torino',                  'TO', 'Piemonte',              'Alessandria'),
  ('Vercelli',                'VC', 'Piemonte',              'Alessandria'),
  ('Novara',                  'NO', 'Piemonte',              'Varese'),
  ('Cuneo',                   'CN', 'Piemonte',              'Alessandria'),
  ('Asti',                    'AT', 'Piemonte',              'Alessandria'),
  ('Alessandria',             'AL', 'Piemonte',              'Alessandria'),
  ('Biella',                  'BI', 'Piemonte',              'Varese'),
  ('Verbano-Cusio-Ossola',    'VB', 'Piemonte',              'Varese'),
  -- Liguria
  ('Genova',                  'GE', 'Liguria',               'Genova'),
  ('Savona',                  'SV', 'Liguria',               'Genova'),
  ('Imperia',                 'IM', 'Liguria',               'Genova'),
  ('La Spezia',               'SP', 'Liguria',               'Genova'),
  -- Lombardia
  ('Varese',                  'VA', 'Lombardia',             'Varese'),
  ('Como',                    'CO', 'Lombardia',             'Varese'),
  ('Lecco',                   'LC', 'Lombardia',             'Varese'),
  ('Sondrio',                 'SO', 'Lombardia',             'Varese'),
  ('Bergamo',                 'BG', 'Lombardia',             'Varese'),
  ('Brescia',                 'BS', 'Lombardia',             'Varese'),
  ('Milano',                  'MI', 'Lombardia',             'Varese'),
  ('Monza e della Brianza',   'MB', 'Lombardia',             'Varese'),
  ('Lodi',                    'LO', 'Lombardia',             'Varese'),
  ('Cremona',                 'CR', 'Lombardia',             'Varese'),
  ('Mantova',                 'MN', 'Lombardia',             'Varese'),
  ('Pavia',                   'PV', 'Lombardia',             'Alessandria'),
  -- Trentino-Alto Adige
  ('Bolzano',                 'BZ', 'Trentino-Alto Adige',   'Varese'),
  ('Trento',                  'TN', 'Trentino-Alto Adige',   'Varese'),
  -- Veneto
  ('Verona',                  'VR', 'Veneto',                'Varese'),
  ('Vicenza',                 'VI', 'Veneto',                'Pesaro Urbino'),
  ('Belluno',                 'BL', 'Veneto',                'Pesaro Urbino'),
  ('Treviso',                 'TV', 'Veneto',                'Pesaro Urbino'),
  ('Venezia',                 'VE', 'Veneto',                'Pesaro Urbino'),
  ('Padova',                  'PD', 'Veneto',                'Pesaro Urbino'),
  ('Rovigo',                  'RO', 'Veneto',                'Pesaro Urbino'),
  -- Friuli-Venezia Giulia
  ('Udine',                   'UD', 'Friuli-Venezia Giulia', 'Pesaro Urbino'),
  ('Gorizia',                 'GO', 'Friuli-Venezia Giulia', 'Pesaro Urbino'),
  ('Trieste',                 'TS', 'Friuli-Venezia Giulia', 'Pesaro Urbino'),
  ('Pordenone',               'PN', 'Friuli-Venezia Giulia', 'Pesaro Urbino'),
  -- Emilia-Romagna
  ('Piacenza',                'PC', 'Emilia-Romagna',        'Genova'),
  ('Parma',                   'PR', 'Emilia-Romagna',        'Genova'),
  ('Reggio Emilia',           'RE', 'Emilia-Romagna',        'Genova'),
  ('Modena',                  'MO', 'Emilia-Romagna',        'Genova'),
  ('Bologna',                 'BO', 'Emilia-Romagna',        'Pesaro Urbino'),
  ('Ferrara',                 'FE', 'Emilia-Romagna',        'Pesaro Urbino'),
  ('Ravenna',                 'RA', 'Emilia-Romagna',        'Pesaro Urbino'),
  ('Forlì-Cesena',            'FC', 'Emilia-Romagna',        'Pesaro Urbino'),
  ('Rimini',                  'RN', 'Emilia-Romagna',        'Pesaro Urbino'),
  -- Toscana
  ('Massa-Carrara',           'MS', 'Toscana',               'Genova'),
  ('Lucca',                   'LU', 'Toscana',               'Genova'),
  ('Pistoia',                 'PT', 'Toscana',               'Pesaro Urbino'),
  ('Firenze',                 'FI', 'Toscana',               'Pesaro Urbino'),
  ('Prato',                   'PO', 'Toscana',               'Pesaro Urbino'),
  ('Livorno',                 'LI', 'Toscana',               'Genova'),
  ('Pisa',                    'PI', 'Toscana',               'Genova'),
  ('Arezzo',                  'AR', 'Toscana',               'Pesaro Urbino'),
  ('Siena',                   'SI', 'Toscana',               'Pesaro Urbino'),
  ('Grosseto',                'GR', 'Toscana',               'Pesaro Urbino'),
  -- Umbria
  ('Perugia',                 'PG', 'Umbria',                'Pesaro Urbino'),
  ('Terni',                   'TR', 'Umbria',                'Ascoli Piceno'),
  -- Marche
  ('Pesaro e Urbino',         'PU', 'Marche',                'Pesaro Urbino'),
  ('Ancona',                  'AN', 'Marche',                'Pesaro Urbino'),
  ('Macerata',                'MC', 'Marche',                'Ascoli Piceno'),
  ('Fermo',                   'FM', 'Marche',                'Ascoli Piceno'),
  ('Ascoli Piceno',           'AP', 'Marche',                'Ascoli Piceno'),
  -- Lazio
  ('Viterbo',                 'VT', 'Lazio',                 'Ascoli Piceno'),
  ('Rieti',                   'RI', 'Lazio',                 'Ascoli Piceno'),
  ('Roma',                    'RM', 'Lazio',                 'Ascoli Piceno'),
  ('Latina',                  'LT', 'Lazio',                 'Napoli'),
  ('Frosinone',               'FR', 'Lazio',                 'Napoli'),
  -- Abruzzo
  ('L''Aquila',               'AQ', 'Abruzzo',               'Ascoli Piceno'),
  ('Teramo',                  'TE', 'Abruzzo',               'Ascoli Piceno'),
  ('Pescara',                 'PE', 'Abruzzo',               'Ascoli Piceno'),
  ('Chieti',                  'CH', 'Abruzzo',               'Ascoli Piceno'),
  -- Molise
  ('Isernia',                 'IS', 'Molise',                'Napoli'),
  ('Campobasso',              'CB', 'Molise',                'Napoli'),
  -- Campania
  ('Caserta',                 'CE', 'Campania',              'Napoli'),
  ('Benevento',               'BN', 'Campania',              'Napoli'),
  ('Napoli',                  'NA', 'Campania',              'Napoli'),
  ('Avellino',                'AV', 'Campania',              'Napoli'),
  ('Salerno',                 'SA', 'Campania',              'Napoli'),
  -- Puglia
  ('Foggia',                  'FG', 'Puglia',                'Napoli'),
  ('Barletta-Andria-Trani',   'BT', 'Puglia',                'Napoli'),
  ('Bari',                    'BA', 'Puglia',                'Napoli'),
  ('Taranto',                 'TA', 'Puglia',                'Napoli'),
  ('Brindisi',                'BR', 'Puglia',                'Napoli'),
  ('Lecce',                   'LE', 'Puglia',                'Napoli'),
  -- Basilicata
  ('Potenza',                 'PZ', 'Basilicata',            'Napoli'),
  ('Matera',                  'MT', 'Basilicata',            'Napoli'),
  -- Calabria
  ('Cosenza',                 'CS', 'Calabria',              'Catania'),
  ('Catanzaro',               'CZ', 'Calabria',              'Catania'),
  ('Crotone',                 'KR', 'Calabria',              'Catania'),
  ('Vibo Valentia',           'VV', 'Calabria',              'Catania'),
  ('Reggio Calabria',         'RC', 'Calabria',              'Catania'),
  -- Sicilia
  ('Palermo',                 'PA', 'Sicilia',               'Ragusa'),
  ('Trapani',                 'TP', 'Sicilia',               'Ragusa'),
  ('Agrigento',               'AG', 'Sicilia',               'Ragusa'),
  ('Caltanissetta',           'CL', 'Sicilia',               'Ragusa'),
  ('Enna',                    'EN', 'Sicilia',               'Ragusa'),
  ('Catania',                 'CT', 'Sicilia',               'Catania'),
  ('Siracusa',                'SR', 'Sicilia',               'Catania'),
  ('Messina',                 'ME', 'Sicilia',               'Catania'),
  ('Ragusa',                  'RG', 'Sicilia',               'Ragusa'),
  -- Sardegna (closest coastal group = Genova)
  ('Sassari',                 'SS', 'Sardegna',              'Genova'),
  ('Nuoro',                   'NU', 'Sardegna',              'Genova'),
  ('Oristano',                'OR', 'Sardegna',              'Genova'),
  ('Cagliari',                'CA', 'Sardegna',              'Genova'),
  ('Sud Sardegna',            'SU', 'Sardegna',              'Genova')
) AS p(nome, code, regione, gruppo);
